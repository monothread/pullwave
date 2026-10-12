import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_KEY_LENGTH, MAX_ICON_BYTES, MangaIcons, parseIconUrl } from '@main/services/manga/mangaIcons';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

const BASE = 'http://127.0.0.1:4321';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

afterEach(() => {
    cleanTempDirs();
});

function setup(options: { baseUrl?: string | null; answer?: () => Promise<Response> } = {}) {
    const directory = join(makeTempDir(), 'icons');
    const requested: string[] = [];
    const fetchImpl = vi.fn((input: string | URL | Request) => {
        requested.push(String(input));
        return options.answer === undefined ? Promise.resolve(new Response(PNG)) : options.answer();
    }) as unknown as typeof fetch;
    const icons = new MangaIcons({
        directory,
        baseUrl: () => {
            return options.baseUrl === undefined ? BASE : options.baseUrl;
        },
        fetchImpl
    });
    return { icons, directory, requested, fetchImpl };
}

async function settled(): Promise<void> {
    await vi.waitFor(() => {
        return undefined;
    });
    await new Promise((resolve) => {
        setTimeout(resolve, 20);
    });
}

describe('parseIconUrl', () => {
    it('reads the key', () => {
        expect(parseIconUrl('pullwave-manga://icon/0123456789abcdef01234567')).toEqual({ key: '0123456789abcdef01234567' });
    });

    it.each([
        ['another scheme', 'http://icon/0123456789abcdef01234567'],
        ['another host', 'pullwave-manga://page/0123456789abcdef01234567'],
        ['a key that is too short', 'pullwave-manga://icon/abc'],
        ['a key with other characters', 'pullwave-manga://icon/0123456789abcdef0123456Z'],
        ['a path', 'pullwave-manga://icon/../etc/passwd'],
        ['extra parts', 'pullwave-manga://icon/0123456789abcdef01234567/x'],
        ['not an address', 'nonsense']
    ])('refuses %s', (_label, url) => {
        expect(parseIconUrl(url)).toBeNull();
    });
});

describe('MangaIcons', () => {
    it('shows an icon that is not kept from the server and takes it in the background', async () => {
        const { icons, directory, requested } = setup();
        const address = `${BASE}/api/v1/extension/icon/fake`;
        expect(icons.present(address)).toBe(address);
        await settled();
        expect(requested).toEqual([address]);
        const key = icons.keyOf('/api/v1/extension/icon/fake');
        expect(key).toMatch(new RegExp(`^[0-9a-f]{${String(ICON_KEY_LENGTH)}}$`));
        expect(readFileSync(join(directory, key))).toEqual(Buffer.from(PNG));
        expect(existsSync(join(directory, `${key}.part`))).toBe(false);
        expect(icons.fileOf(key)).toBe(join(directory, key));
    });

    it('shows an icon that is kept from the data folder, and asks for it once more in the run in case it changed', async () => {
        const { icons, requested } = setup();
        const address = `${BASE}/api/v1/extension/icon/fake`;
        icons.present(address);
        await settled();
        const key = icons.keyOf('/api/v1/extension/icon/fake');
        expect(icons.present(address)).toBe(`pullwave-manga://icon/${key}`);
        expect(icons.present(address)).toBe(`pullwave-manga://icon/${key}`);
        await settled();
        expect(requested).toHaveLength(1);
    });

    it('asks again in the next run, and keeps the new icon when the source changed it', async () => {
        const first = setup();
        const address = `${BASE}/api/v1/extension/icon/fake`;
        first.icons.present(address);
        await settled();
        const key = first.icons.keyOf('/api/v1/extension/icon/fake');
        const next = new MangaIcons({
            directory: first.directory,
            baseUrl: () => {
                return BASE;
            },
            fetchImpl: (() => {
                return Promise.resolve(new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9])));
            }) as unknown as typeof fetch
        });
        expect(next.present(address)).toBe(`pullwave-manga://icon/${key}`);
        await settled();
        expect(readFileSync(join(first.directory, key))).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]));
    });

    it('gives the same key for the same icon whatever port the server has', () => {
        const { icons } = setup();
        expect(icons.keyOf('/api/v1/extension/icon/a')).toBe(icons.keyOf('/api/v1/extension/icon/a'));
        expect(icons.keyOf('/api/v1/extension/icon/a')).not.toBe(icons.keyOf('/api/v1/extension/icon/b'));
        const other = setup({ baseUrl: 'http://127.0.0.1:9999' });
        other.icons.present('http://127.0.0.1:9999/api/v1/extension/icon/a');
        expect(other.icons.keyOf('/api/v1/extension/icon/a')).toBe(icons.keyOf('/api/v1/extension/icon/a'));
    });

    it('gives nothing for no icon, and asks for nothing', () => {
        const { icons, fetchImpl } = setup();
        expect(icons.present(null)).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('keeps an address that is not the server as it is, taking it as a whole address', async () => {
        const { icons, requested } = setup({ baseUrl: null });
        expect(icons.present('https://cdn.example/icon.png')).toBe('https://cdn.example/icon.png');
        await settled();
        expect(requested).toEqual(['https://cdn.example/icon.png']);
    });

    it('keeps nothing when the icon does not come, is not an image, is empty or is too big', async () => {
        const tooBig = Uint8Array.from({ length: MAX_ICON_BYTES + 1 }, (_item, index) => {
            return index < PNG.length ? PNG[index]! : 0;
        });
        const answers: Array<() => Promise<Response>> = [
            () => {
                return Promise.resolve(new Response('no', { status: 404 }));
            },
            () => {
                return Promise.reject(new Error('offline'));
            },
            () => {
                return Promise.resolve(new Response('<html></html>'));
            },
            () => {
                return Promise.resolve(new Response(new Uint8Array(0)));
            },
            () => {
                return Promise.resolve(new Response(tooBig));
            }
        ];
        for (const [index, answer] of answers.entries()) {
            const { icons, directory } = setup({ answer });
            icons.present(`${BASE}/api/v1/extension/icon/fake${String(index)}`);
            await settled();
            expect(existsSync(join(directory, icons.keyOf(`/api/v1/extension/icon/fake${String(index)}`)))).toBe(false);
        }
    });

    it('keeps the icon it had when the new one does not come', async () => {
        const first = setup();
        const address = `${BASE}/api/v1/extension/icon/fake`;
        first.icons.present(address);
        await settled();
        const key = first.icons.keyOf('/api/v1/extension/icon/fake');
        const next = new MangaIcons({
            directory: first.directory,
            baseUrl: () => {
                return BASE;
            },
            fetchImpl: (() => {
                return Promise.reject(new Error('offline'));
            }) as unknown as typeof fetch
        });
        expect(next.present(address)).toBe(`pullwave-manga://icon/${key}`);
        await settled();
        expect(readFileSync(join(first.directory, key))).toEqual(Buffer.from(PNG));
    });

    it('does not ask for a path of the server while it is not running, and asks when it is', async () => {
        const state = { base: null as string | null };
        const requested: string[] = [];
        const directory = join(makeTempDir(), 'icons');
        const icons = new MangaIcons({
            directory,
            baseUrl: () => {
                return state.base;
            },
            fetchImpl: ((input: string) => {
                requested.push(String(input));
                return Promise.resolve(new Response(PNG));
            }) as unknown as typeof fetch
        });
        expect(icons.present('/api/v1/extension/icon/fake')).toBe('/api/v1/extension/icon/fake');
        await settled();
        expect(requested).toEqual([]);
        state.base = BASE;
        icons.present(`${BASE}/api/v1/extension/icon/fake`);
        await settled();
        expect(requested).toEqual([`${BASE}/api/v1/extension/icon/fake`]);
    });

    it('has no file for a key that is not kept, and reads the file of one that is', async () => {
        const { icons, directory } = setup();
        expect(icons.fileOf('0'.repeat(ICON_KEY_LENGTH))).toBeNull();
        icons.present(`${BASE}/api/v1/extension/icon/fake`);
        await settled();
        const key = icons.keyOf('/api/v1/extension/icon/fake');
        writeFileSync(join(directory, key), PNG);
        await expect(icons.read(join(directory, key))).resolves.toEqual(Buffer.from(PNG));
    });
});
