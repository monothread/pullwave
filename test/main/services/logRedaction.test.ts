import { REDACTED, redactArgs, redactText } from '@main/services/logRedaction';

describe('REDACTED', () => {
    it('is three asterisks', () => {
        expect(REDACTED).toBe('***');
    });
});

describe('redactText', () => {
    it('leaves a text without secrets as it is', () => {
        expect(redactText('[download] Destination: /home/user/Videos/clip.mp4')).toBe('[download] Destination: /home/user/Videos/clip.mp4');
        expect(redactText('')).toBe('');
    });

    it('hides the value of every header that carries a credential, whatever its case and separator', () => {
        expect(redactText('Authorization: Bearer abc.def')).toBe('Authorization: ***');
        expect(redactText('proxy-authorization=Basic Zm9vOmJhcg==')).toBe('proxy-authorization=***');
        expect(redactText('Cookie:session=1; theme=dark')).toBe('Cookie:***');
        expect(redactText('Set-Cookie: id=42; Path=/')).toBe('Set-Cookie: ***');
        expect(redactText('X-Api-Key: k123')).toBe('X-Api-Key: ***');
        expect(redactText('x-goog-api-key: AIza999')).toBe('x-goog-api-key: ***');
        expect(redactText('api-key=xyz')).toBe('api-key=***');
    });

    it('stops the value of a header at a quote', () => {
        expect(redactText('headers {"Cookie": "a=1"}')).toBe('headers {"Cookie": "***"}');
        expect(redactText('"Cookie:a=1; b=2" next')).toBe('"Cookie:***" next');
    });

    it('hides a header written as a key of Python, the way yt-dlp prints its headers', () => {
        expect(redactText("[debug] headers {'Cookie': 'a=1; b=2', 'User-Agent': 'Mozilla'}")).toBe("[debug] headers {'Cookie': '***', 'User-Agent': 'Mozilla'}");
    });

    it('does not take the option of the cookies of a browser for a header', () => {
        expect(redactText('--cookies-from-browser firefox')).toBe('--cookies-from-browser firefox');
    });

    it('hides a bearer or basic token out of a header', () => {
        expect(redactText('sent Bearer eyJhbGci.payload.sig to the server')).toBe('sent Bearer *** to the server');
        expect(redactText('using Basic dXNlcjpwYXNz')).toBe('using Basic ***');
    });

    it('hides the parameters of an address whose name says they are secrets, and keeps the others', () => {
        expect(redactText('https://cdn.test/v.m3u8?token=abc&quality=720&sig=XYZ#t=1')).toBe('https://cdn.test/v.m3u8?token=***&quality=720&sig=***#t=1');
        expect(redactText('https://api.test/x?key=AIza&alt=json')).toBe('https://api.test/x?key=***&alt=json');
        expect(redactText('https://s3.test/f?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA%2F1')).toBe('https://s3.test/f?X-Amz-Signature=***&X-Amz-Credential=***');
        expect(redactText('https://akamai.test/a.ts?hdnts=exp=1~hmac=ff;session_id=9')).toBe('https://akamai.test/a.ts?hdnts=***;session_id=***');
        expect(redactText('https://x.test/?access_token=1&auth=2&password=3&secret=4&Policy=5')).toBe('https://x.test/?access_token=***&auth=***&password=***&secret=***&Policy=***');
        expect(redactText('https://x.test/watch?v=dQw4w9WgXcQ&list=PL1')).toBe('https://x.test/watch?v=dQw4w9WgXcQ&list=PL1');
    });

    it('stops the value of a secret parameter at a space or a quote', () => {
        expect(redactText('"https://x.test/?token=abc" and more')).toBe('"https://x.test/?token=***" and more');
        expect(redactText("'https://x.test/?token=abc' and more")).toBe("'https://x.test/?token=***' and more");
    });

    it('hides the password of an address with a user, and keeps the user and the host', () => {
        expect(redactText('proxy http://alice:s3cret@proxy.test:8080/ in use')).toBe('proxy http://alice:***@proxy.test:8080/ in use');
        expect(redactText('socks5://bob:pw@127.0.0.1')).toBe('socks5://bob:***@127.0.0.1');
    });

    it('does not take a port for a password', () => {
        expect(redactText('http://127.0.0.1:4567/api/graphql')).toBe('http://127.0.0.1:4567/api/graphql');
    });

    it('hides every secret of a line that has several', () => {
        expect(redactText('GET https://x.test/?token=a Authorization: Bearer b')).toBe('GET https://x.test/?token=*** Authorization: ***');
    });
});

describe('redactArgs', () => {
    it('keeps arguments without secrets as they are and does not change the array it gets', () => {
        const args = ['--newline', '-f', 'bv*+ba', 'https://x.test/watch?v=1'];
        expect(redactArgs(args)).toEqual(['--newline', '-f', 'bv*+ba', 'https://x.test/watch?v=1']);
        expect(args).toEqual(['--newline', '-f', 'bv*+ba', 'https://x.test/watch?v=1']);
    });

    it('hides the value that follows each option of a password', () => {
        expect(redactArgs(['--username', 'me', '--password', 'p1', '--video-password', 'p2', '--ap-password', 'p3', '--twofactor', '123456', '--client-certificate-password', 'p4'])).toEqual([
            '--username',
            'me',
            '--password',
            '***',
            '--video-password',
            '***',
            '--ap-password',
            '***',
            '--twofactor',
            '***',
            '--client-certificate-password',
            '***'
        ]);
    });

    it('hides the value of an option of a password written with an equals sign', () => {
        expect(redactArgs(['--password=p1', '--video-password=p2', '--format=best'])).toEqual(['--password=***', '--video-password=***', '--format=best']);
    });

    it('hides a header given as an argument and the secrets of an address', () => {
        expect(redactArgs(['--add-header', 'Cookie:a=1; b=2', '--add-header', 'Authorization: Bearer t', 'https://x.test/?token=z'])).toEqual([
            '--add-header',
            'Cookie:***',
            '--add-header',
            'Authorization: ***',
            'https://x.test/?token=***'
        ]);
    });

    it('treats an option of a password as the last argument as a plain argument', () => {
        expect(redactArgs(['--password'])).toEqual(['--password']);
    });

    it('returns an empty array for no arguments', () => {
        expect(redactArgs([])).toEqual([]);
    });
});
