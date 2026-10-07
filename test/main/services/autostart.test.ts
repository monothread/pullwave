import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Autostart, DESKTOP_ENTRY_NAME, buildDesktopEntry, defaultAutostartFiles, quoteExecArgument, type AutostartDependencies } from '@main/services/autostart';

function setup(overrides: Partial<AutostartDependencies> = {}) {
    const files = { write: vi.fn(), remove: vi.fn() };
    const setLoginItem = vi.fn();
    const deps: AutostartDependencies = {
        platform: 'linux',
        canRegister: true,
        command: '/opt/Pullwave/pullwave',
        autostartDir: '/home/me/.config/autostart',
        files,
        setLoginItem,
        ...overrides
    };
    return { autostart: new Autostart(deps), files, setLoginItem };
}

describe('quoteExecArgument', () => {
    it('puts the program between quotes', () => {
        expect(quoteExecArgument('/opt/Pullwave/pullwave')).toBe('"/opt/Pullwave/pullwave"');
    });

    it('keeps spaces inside the quotes', () => {
        expect(quoteExecArgument('/home/me/My Apps/pullwave')).toBe('"/home/me/My Apps/pullwave"');
    });

    it('escapes the characters the format reserves inside quotes', () => {
        expect(quoteExecArgument('/a"b`c$d')).toBe('"/a\\\\"b\\\\`c\\\\$d"');
    });

    it('writes a backslash four times (escaped for the quotes, then for the string)', () => {
        expect(quoteExecArgument('/a\\b')).toBe('"/a\\\\\\\\b"');
    });

    it('doubles the percent sign so it is not read as a field code', () => {
        expect(quoteExecArgument('/a%b')).toBe('"/a%%b"');
    });
});

describe('buildDesktopEntry', () => {
    it('describes an application that starts with the flag of the start at login', () => {
        expect(buildDesktopEntry('/opt/Pullwave/pullwave')).toBe(
            [
                '[Desktop Entry]',
                'Type=Application',
                'Name=Pullwave',
                'Comment=Cyberpunk yt-dlp GUI and video downloader',
                'Exec="/opt/Pullwave/pullwave" --autostart',
                'Icon=pullwave',
                'Terminal=false',
                'X-GNOME-Autostart-enabled=true',
                ''
            ].join('\n')
        );
    });
});

describe('Autostart on Linux', () => {
    it('writes the entry when enabled', () => {
        const { autostart, files, setLoginItem } = setup();
        autostart.sync(true);
        expect(files.write).toHaveBeenCalledTimes(1);
        expect(files.write).toHaveBeenCalledWith(join('/home/me/.config/autostart', DESKTOP_ENTRY_NAME), buildDesktopEntry('/opt/Pullwave/pullwave'));
        expect(files.remove).not.toHaveBeenCalled();
        expect(setLoginItem).not.toHaveBeenCalled();
    });

    it('starts the AppImage rather than the executable inside it', () => {
        const { autostart, files } = setup({ command: '/home/me/Apps/pullwave-0.21.0.AppImage' });
        autostart.sync(true);
        expect(files.write).toHaveBeenCalledWith(join('/home/me/.config/autostart', 'pullwave.desktop'), expect.stringContaining('Exec="/home/me/Apps/pullwave-0.21.0.AppImage" --autostart\n'));
    });

    it('removes the entry when disabled', () => {
        const { autostart, files } = setup();
        autostart.sync(false);
        expect(files.remove).toHaveBeenCalledTimes(1);
        expect(files.remove).toHaveBeenCalledWith(join('/home/me/.config/autostart', 'pullwave.desktop'));
        expect(files.write).not.toHaveBeenCalled();
    });

    it('does not throw when the entry cannot be written', () => {
        const { autostart, files } = setup();
        files.write.mockImplementation(() => {
            throw new Error('EACCES');
        });
        expect(() => {
            autostart.sync(true);
        }).not.toThrow();
    });

    it('does not throw when the entry cannot be removed', () => {
        const { autostart, files } = setup();
        files.remove.mockImplementation(() => {
            throw new Error('EACCES');
        });
        expect(() => {
            autostart.sync(false);
        }).not.toThrow();
    });
});

describe('Autostart on Windows', () => {
    it('sets the login item with the flag when enabled', () => {
        const { autostart, files, setLoginItem } = setup({ platform: 'win32' });
        autostart.sync(true);
        expect(setLoginItem).toHaveBeenCalledTimes(1);
        expect(setLoginItem).toHaveBeenCalledWith(true, ['--autostart']);
        expect(files.write).not.toHaveBeenCalled();
        expect(files.remove).not.toHaveBeenCalled();
    });

    it('turns the login item off when disabled', () => {
        const { autostart, setLoginItem } = setup({ platform: 'win32' });
        autostart.sync(false);
        expect(setLoginItem).toHaveBeenCalledWith(false, ['--autostart']);
    });
});

describe('Autostart where it cannot be registered', () => {
    it('does nothing for an app that is not installed', () => {
        const { autostart, files, setLoginItem } = setup({ canRegister: false });
        autostart.sync(true);
        autostart.sync(false);
        expect(files.write).not.toHaveBeenCalled();
        expect(files.remove).not.toHaveBeenCalled();
        expect(setLoginItem).not.toHaveBeenCalled();
    });

    it('does nothing on a system it does not support', () => {
        const { autostart, files, setLoginItem } = setup({ platform: 'darwin' });
        autostart.sync(true);
        expect(files.write).not.toHaveBeenCalled();
        expect(setLoginItem).not.toHaveBeenCalled();
    });
});

describe('defaultAutostartFiles', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pullwave-autostart-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('creates the folder and writes the file', () => {
        const path = join(dir, 'autostart', 'pullwave.desktop');
        defaultAutostartFiles.write(path, 'content');
        expect(readFileSync(path, 'utf-8')).toBe('content');
    });

    it('replaces a file that exists', () => {
        const path = join(dir, 'pullwave.desktop');
        defaultAutostartFiles.write(path, 'old');
        defaultAutostartFiles.write(path, 'new');
        expect(readFileSync(path, 'utf-8')).toBe('new');
    });

    it('removes the file', () => {
        mkdirSync(join(dir, 'autostart'));
        const path = join(dir, 'autostart', 'pullwave.desktop');
        writeFileSync(path, 'content');
        defaultAutostartFiles.remove(path);
        expect(existsSync(path)).toBe(false);
    });

    it('does not fail when there is no file to remove', () => {
        expect(() => {
            defaultAutostartFiles.remove(join(dir, 'missing.desktop'));
        }).not.toThrow();
    });
});
