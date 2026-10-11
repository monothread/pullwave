import { SUWAYOMI_VERSION, suwayomiSpec } from '@main/services/tools/suwayomiRelease';

describe('suwayomiSpec', () => {
    it('is the tar.gz of the Linux x64 release', () => {
        expect(suwayomiSpec('linux', 'x64')).toEqual({
            id: 'suwayomi',
            version: SUWAYOMI_VERSION,
            url: `https://github.com/Suwayomi/Suwayomi-Server/releases/download/${SUWAYOMI_VERSION}/Suwayomi-Server-${SUWAYOMI_VERSION}-linux-x64.tar.gz`,
            sha256: '7a469f8c820e65305f795d61f1776c783919884531497b587bdff898a7e0fa73',
            sizeBytes: 337_841_487,
            format: 'tar.gz',
            stripComponents: 1,
            exclude: ['electron'],
            executables: ['jre/bin/java'],
            entry: 'bin/Suwayomi-Server.jar'
        });
    });

    it('is the zip of the Windows x64 release', () => {
        expect(suwayomiSpec('win32', 'x64')).toEqual({
            id: 'suwayomi',
            version: SUWAYOMI_VERSION,
            url: `https://github.com/Suwayomi/Suwayomi-Server/releases/download/${SUWAYOMI_VERSION}/Suwayomi-Server-${SUWAYOMI_VERSION}-windows-x64.zip`,
            sha256: 'b955f374a8d94b8d1c2750ae28fa7eb2066b479957561b5ba9cf8ac993c8fc13',
            sizeBytes: 343_828_201,
            format: 'zip',
            stripComponents: 1,
            exclude: ['electron'],
            executables: ['jre/bin/java.exe'],
            entry: 'bin/Suwayomi-Server.jar'
        });
    });

    it('is null where there is no release for the system', () => {
        expect(suwayomiSpec('darwin', 'arm64')).toBeNull();
        expect(suwayomiSpec('darwin', 'x64')).toBeNull();
        expect(suwayomiSpec('linux', 'arm64')).toBeNull();
        expect(suwayomiSpec('win32', 'ia32')).toBeNull();
        expect(suwayomiSpec('freebsd', 'x64')).toBeNull();
    });

    it('downloads over https from the project of Suwayomi only', () => {
        ['linux', 'win32'].forEach((platform) => {
            const spec = suwayomiSpec(platform as NodeJS.Platform, 'x64');
            expect(spec?.url.startsWith('https://github.com/Suwayomi/Suwayomi-Server/releases/download/')).toBe(true);
            expect(spec?.sha256).toMatch(/^[0-9a-f]{64}$/);
        });
    });
});
