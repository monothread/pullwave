import { autoUpdater } from 'electron-updater';
import { getElectronUpdater } from '@main/services/electronUpdater';

vi.mock('electron-updater', () => {
    return { autoUpdater: { autoDownload: true, autoInstallOnAppQuit: true, logger: console } };
});

describe('getElectronUpdater', () => {
    it('returns the electron-updater singleton configured for manual download and install', () => {
        const updater = getElectronUpdater();
        expect(updater).toBe(autoUpdater);
        expect(autoUpdater.autoDownload).toBe(false);
        expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
        expect(autoUpdater.logger).toBeNull();
    });
});
