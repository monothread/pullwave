import { basename, posix, win32 } from 'node:path';
import type { RegisteredBrowser } from './browserIdentity';
import type { ExecFileFn } from './binaryLocator';

export interface RegistrySources {
    platform: NodeJS.Platform;
    homeDir: string;
    env: Record<string, string | undefined>;
    applicationDirs?: string[];
}

export interface RegistryReader {
    listFiles: (dir: string) => Promise<string[]>;
    readText: (path: string) => Promise<string | null>;
    exec: ExecFileFn;
}

const HTTP_HANDLER = 'x-scheme-handler/http';
const START_MENU_ROOTS = [
    'HKLM\\SOFTWARE\\Clients\\StartMenuInternet',
    'HKLM\\SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet',
    'HKCU\\SOFTWARE\\Clients\\StartMenuInternet'
];

interface DesktopEntry {
    name: string;
    exec: string;
    mimeTypes: string[];
}

export function parseDesktopEntry(text: string): DesktopEntry | null {
    const fields: Record<string, string> = {};
    let inMainGroup = false;
    text.split(/\r?\n/).forEach((rawLine) => {
        const line = rawLine.trim();
        if (line.startsWith('[')) {
            inMainGroup = line === '[Desktop Entry]';
            return;
        }
        const separator = line.indexOf('=');
        if (inMainGroup && separator > 0) {
            fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
        }
    });
    if (!fields.Name || !fields.Exec || fields.NoDisplay === 'true' || fields.Hidden === 'true') {
        return null;
    }
    return { name: fields.Name, exec: fields.Exec, mimeTypes: (fields.MimeType ?? '').split(';') };
}

export function programOfExec(exec: string): string | null {
    const tokens = exec.match(/"[^"]*"|\S+/g) ?? [];
    const words = tokens.map((token) => {
        return token.replace(/^"|"$/g, '');
    });
    const program = words.find((word, index) => {
        return !(index === 0 && word === 'env') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
    });
    if (!program || program.startsWith('%')) {
        return null;
    }
    const name = basename(program);
    return name === 'flatpak' || name === 'snap' || name === 'sh' || name === 'bash' ? null : name;
}

function linuxApplicationDirs(sources: RegistrySources): string[] {
    if (sources.applicationDirs) {
        return sources.applicationDirs;
    }
    const { env, homeDir } = sources;
    const dataHome = env.XDG_DATA_HOME || posix.join(homeDir, '.local', 'share');
    const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter((dir) => {
        return dir.length > 0;
    });
    return [
        ...[dataHome, ...dataDirs].map((dir) => {
            return posix.join(dir, 'applications');
        }),
        '/var/lib/snapd/desktop/applications',
        '/var/lib/flatpak/exports/share/applications',
        posix.join(homeDir, '.local', 'share', 'flatpak', 'exports', 'share', 'applications')
    ];
}

async function listLinuxBrowsers(sources: RegistrySources, reader: RegistryReader): Promise<RegisteredBrowser[]> {
    const perDirectory = await Promise.all(
        linuxApplicationDirs(sources).map(async (dir) => {
            const files = (await reader.listFiles(dir)).filter((file) => {
                return file.endsWith('.desktop');
            });
            return Promise.all(
                files.map(async (file) => {
                    const text = await reader.readText(posix.join(dir, file));
                    const entry = text === null ? null : parseDesktopEntry(text);
                    const program = entry ? programOfExec(entry.exec) : null;
                    return entry && program && entry.mimeTypes.includes(HTTP_HANDLER) ? { name: entry.name, key: program } : null;
                })
            );
        })
    );
    return perDirectory.flat().filter((browser): browser is RegisteredBrowser => {
        return browser !== null;
    });
}

export function parseRegistryValue(output: string): string | null {
    const match = /REG_SZ\s+(.+)/.exec(output);
    return match?.[1]?.trim() ?? null;
}

export function parseRegistrySubKeys(output: string, parentKey: string): string[] {
    return output
        .split(/\r?\n/)
        .map((line) => {
            return line.trim();
        })
        .filter((line) => {
            return line.length > parentKey.length && line.toLowerCase().startsWith(parentKey.toLowerCase() + '\\');
        });
}

export function productFolderOfCommand(command: string): string | null {
    const executable = /^"?([^"]+?\.exe)/i.exec(command.trim())?.[1];
    if (!executable) {
        return null;
    }
    const folders = win32.dirname(executable).split('\\').filter((part) => {
        return part.length > 0;
    });
    const applicationIndex = folders.findIndex((part) => {
        return part.toLowerCase() === 'application';
    });
    return (applicationIndex > 0 ? folders[applicationIndex - 1] : folders[folders.length - 1]) ?? null;
}

async function queryValue(reader: RegistryReader, key: string): Promise<string | null> {
    try {
        return parseRegistryValue(await reader.exec('reg', ['query', key, '/ve']));
    } catch {
        return null;
    }
}

async function querySubKeys(reader: RegistryReader, root: string): Promise<string[]> {
    const longRoot = root.replace(/^HKLM/, 'HKEY_LOCAL_MACHINE').replace(/^HKCU/, 'HKEY_CURRENT_USER');
    try {
        return parseRegistrySubKeys(await reader.exec('reg', ['query', root]), longRoot);
    } catch {
        return [];
    }
}

async function describeStartMenuEntry(reader: RegistryReader, subKey: string): Promise<RegisteredBrowser | null> {
    const [name, command] = await Promise.all([queryValue(reader, subKey), queryValue(reader, `${subKey}\\shell\\open\\command`)]);
    const key = command === null ? null : productFolderOfCommand(command);
    return name && key ? { name, key } : null;
}

async function listWindowsBrowsers(reader: RegistryReader): Promise<RegisteredBrowser[]> {
    const subKeys = (
        await Promise.all(
            START_MENU_ROOTS.map((root) => {
                return querySubKeys(reader, root);
            })
        )
    ).flat();
    const entries = await Promise.all(
        subKeys.map((subKey) => {
            return describeStartMenuEntry(reader, subKey);
        })
    );
    return entries.filter((browser): browser is RegisteredBrowser => {
        return browser !== null;
    });
}

export async function listRegisteredBrowsers(sources: RegistrySources, reader: RegistryReader): Promise<RegisteredBrowser[]> {
    try {
        if (sources.platform === 'win32') {
            return await listWindowsBrowsers(reader);
        }
        return sources.platform === 'linux' ? await listLinuxBrowsers(sources, reader) : [];
    } catch {
        return [];
    }
}
