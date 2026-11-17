import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SettingsStore } from '@main/services/settingsStore';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

describe('SettingsStore', () => {
    it('returns the defaults when nothing is stored', () => {
        expect(new SettingsStore(join(makeTempDir(), 's.json')).get()).toEqual(DEFAULT_SETTINGS);
    });

    it('persists sanitized settings and returns them', () => {
        const path = join(makeTempDir(), 's.json');
        const store = new SettingsStore(path);
        const saved = store.save({ ...DEFAULT_SETTINGS, downloadDir: ' /media ', maxTitleLength: 5000 });
        expect(saved).toEqual({ ...DEFAULT_SETTINGS, downloadDir: '/media', maxTitleLength: 200 });
        expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(saved);
        expect(new SettingsStore(path).get()).toEqual(saved);
    });

    it('fills in missing keys of an older stored file with defaults', () => {
        const path = join(makeTempDir(), 's.json');
        writeFileSync(path, JSON.stringify({ downloadDir: '/old' }));
        expect(new SettingsStore(path).get()).toEqual({ ...DEFAULT_SETTINGS, downloadDir: '/old' });
    });

    it.each([
        ['nord', { themeMode: 'dark', themeFamily: 'nord' }],
        ['sakura', { themeMode: 'light', themeFamily: 'sakura' }],
        ['device', { themeMode: 'device', themeFamily: 'default' }]
    ] as const)('moves the theme %s an older version saved to its mode and family', (theme, choice) => {
        const path = join(makeTempDir(), 's.json');
        writeFileSync(path, JSON.stringify({ downloadDir: '/old', theme }));
        expect(new SettingsStore(path).get()).toEqual({ ...DEFAULT_SETTINGS, downloadDir: '/old', ...choice });
    });

    it('keeps the mode and family a newer file saved, and ignores an old theme beside them', () => {
        const path = join(makeTempDir(), 's.json');
        writeFileSync(path, JSON.stringify({ theme: 'nord', themeMode: 'light', themeFamily: 'gruvbox' }));
        expect(new SettingsStore(path).get()).toEqual({ ...DEFAULT_SETTINGS, themeMode: 'light', themeFamily: 'gruvbox' });
    });

    it('reads the file once and keeps the settings after that', () => {
        const path = join(makeTempDir(), 's.json');
        writeFileSync(path, JSON.stringify({ downloadDir: '/first' }));
        const store = new SettingsStore(path);
        expect(store.get().downloadDir).toBe('/first');
        writeFileSync(path, JSON.stringify({ downloadDir: '/changed-outside' }));
        expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, downloadDir: '/first' });
    });

    it('gives the saved settings after a save, without reading the file', () => {
        const path = join(makeTempDir(), 's.json');
        const store = new SettingsStore(path);
        store.get();
        store.save({ ...DEFAULT_SETTINGS, downloadDir: '/saved' });
        writeFileSync(path, '{ broken');
        expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, downloadDir: '/saved' });
    });

    it('gives a copy each time, so changing what was given does not change the settings', () => {
        const store = new SettingsStore(join(makeTempDir(), 's.json'));
        const given = store.get();
        given.downloadDir = '/changed';
        expect(store.get().downloadDir).toBe(DEFAULT_SETTINGS.downloadDir);
        const saved = store.save({ ...DEFAULT_SETTINGS, downloadDir: '/saved' });
        saved.downloadDir = '/changed-again';
        expect(store.get().downloadDir).toBe('/saved');
    });
});
