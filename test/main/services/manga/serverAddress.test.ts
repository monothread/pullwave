import { fromStoredAddress, toStoredAddress } from '@main/services/manga/serverAddress';

const BASE = 'http://127.0.0.1:4321';

describe('toStoredAddress', () => {
    it('keeps only the path of an address on the server', () => {
        expect(toStoredAddress(`${BASE}/api/v1/manga/7/thumbnail`, BASE)).toBe('/api/v1/manga/7/thumbnail');
        expect(toStoredAddress(`${BASE}/api/v1/manga/7/thumbnail?x=1`, BASE)).toBe('/api/v1/manga/7/thumbnail?x=1');
    });

    it('keeps an address on another server as it is', () => {
        expect(toStoredAddress('https://cdn.example/a.jpg', BASE)).toBe('https://cdn.example/a.jpg');
        expect(toStoredAddress('http://127.0.0.1:9999/a.jpg', BASE)).toBe('http://127.0.0.1:9999/a.jpg');
    });

    it('keeps what it cannot read, and does nothing when it knows nothing', () => {
        expect(toStoredAddress('/already/a/path', BASE)).toBe('/already/a/path');
        expect(toStoredAddress(`${BASE}/x`, 'not a url')).toBe(`${BASE}/x`);
        expect(toStoredAddress(`${BASE}/x`, null)).toBe(`${BASE}/x`);
        expect(toStoredAddress(null, BASE)).toBeNull();
    });
});

describe('fromStoredAddress', () => {
    it('completes a path with the server of the moment', () => {
        expect(fromStoredAddress('/api/v1/manga/7/thumbnail', BASE)).toBe(`${BASE}/api/v1/manga/7/thumbnail`);
        expect(fromStoredAddress('/api/x', `${BASE}/`)).toBe(`${BASE}/api/x`);
    });

    it('is null for a path while the server is not known', () => {
        expect(fromStoredAddress('/api/x', null)).toBeNull();
    });

    it('keeps a whole address and a missing one', () => {
        expect(fromStoredAddress('https://cdn.example/a.jpg', BASE)).toBe('https://cdn.example/a.jpg');
        expect(fromStoredAddress('https://cdn.example/a.jpg', null)).toBe('https://cdn.example/a.jpg');
        expect(fromStoredAddress(null, BASE)).toBeNull();
    });

    it('gives back what toStoredAddress took apart, even on another port', () => {
        const stored = toStoredAddress(`${BASE}/api/v1/manga/7/thumbnail`, BASE);
        expect(fromStoredAddress(stored, 'http://127.0.0.1:5555')).toBe('http://127.0.0.1:5555/api/v1/manga/7/thumbnail');
    });
});
