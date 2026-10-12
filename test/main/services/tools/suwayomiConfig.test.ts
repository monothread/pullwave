import { applyManagedSettings, managedSettings } from '@main/services/tools/suwayomiConfig';

describe('managedSettings', () => {
    it('keeps the server on this machine, on the port given, with no windows and no web interface', () => {
        expect(managedSettings(4321)).toEqual({
            ip: '127.0.0.1',
            port: 4321,
            webUIEnabled: false,
            initialOpenInBrowserEnabled: false,
            systemTrayEnabled: false,
            debugLogsEnabled: false,
            flareSolverrEnabled: false
        });
    });

    it('turns the Cloudflare bypass on, pointing at the FlareSolverr of the app, when there is one', () => {
        expect(managedSettings(4321, 'http://127.0.0.1:8191')).toEqual({
            ip: '127.0.0.1',
            port: 4321,
            webUIEnabled: false,
            initialOpenInBrowserEnabled: false,
            systemTrayEnabled: false,
            debugLogsEnabled: false,
            flareSolverrEnabled: true,
            flareSolverrUrl: 'http://127.0.0.1:8191',
            flareSolverrAsResponseFallback: true
        });
    });

    it('uses the page FlareSolverr got as the answer when the request made again with its cookies is refused, only with a FlareSolverr', () => {
        expect(managedSettings(4321, 'http://127.0.0.1:8191')).toHaveProperty('flareSolverrAsResponseFallback', true);
        expect(managedSettings(4321, null)).not.toHaveProperty('flareSolverrAsResponseFallback');
        expect(managedSettings(4321)).not.toHaveProperty('flareSolverrAsResponseFallback');
    });

    it('leaves the address of FlareSolverr out when there is none', () => {
        expect(managedSettings(4321, null)).not.toHaveProperty('flareSolverrUrl');
        expect(managedSettings(4321)).toHaveProperty('flareSolverrEnabled', false);
    });
});

describe('applyManagedSettings', () => {
    it('writes the whole file when there is none', () => {
        expect(applyManagedSettings('', { ip: '127.0.0.1', port: 4321, webUIEnabled: false })).toBe(
            'server.ip = "127.0.0.1"\nserver.port = 4321\nserver.webUIEnabled = false\n'
        );
    });

    it('replaces the values that are there and keeps everything else', () => {
        const conf = [
            '# comment',
            'server.ip = "0.0.0.0" # the address',
            'server.port = 4567',
            'server.extensionStores = ["https://a.example/index.json"]',
            'server.webUIEnabled = true',
            ''
        ].join('\n');
        expect(applyManagedSettings(conf, { ip: '127.0.0.1', port: 4321, webUIEnabled: false })).toBe(
            [
                '# comment',
                'server.ip = "127.0.0.1"',
                'server.port = 4321',
                'server.extensionStores = ["https://a.example/index.json"]',
                'server.webUIEnabled = false',
                ''
            ].join('\n')
        );
    });

    it('adds the values that are missing, on a new line even if the file does not end with one', () => {
        expect(applyManagedSettings('server.port = 1', { port: 2, ip: '127.0.0.1' })).toBe('server.port = 2\nserver.ip = "127.0.0.1"\n');
        expect(applyManagedSettings('server.other = 1\n', { port: 2 })).toBe('server.other = 1\nserver.port = 2\n');
    });

    it('does not take a key that only starts like another for it', () => {
        expect(applyManagedSettings('server.portal = 9\n', { port: 2 })).toBe('server.portal = 9\nserver.port = 2\n');
    });

    it('quotes text and escapes what needs it', () => {
        expect(applyManagedSettings('', { ip: 'a"b\\c' })).toBe('server.ip = "a\\"b\\\\c"\n');
    });

    it('leaves a dollar sign in a value as it is', () => {
        expect(applyManagedSettings('server.ip = "x"\n', { ip: '$&' })).toBe('server.ip = "$&"\n');
    });

    it('does nothing when there is nothing to set', () => {
        expect(applyManagedSettings('server.port = 1\n', {})).toBe('server.port = 1\n');
    });
});
