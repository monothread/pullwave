// The server listens on a port that is different at every start, so what is kept in the library names its own addresses without
// the part that changes (`/api/v1/manga/7/thumbnail`) and they are completed with the server of the moment when they are shown.

// The address as it is kept: a path of the server when it is one of its own, otherwise the address itself.
export function toStoredAddress(address: string | null, baseUrl: string | null): string | null {
    if (address === null || baseUrl === null) {
        return address;
    }
    try {
        const target = new URL(address);
        const base = new URL(baseUrl);
        return target.origin === base.origin ? `${target.pathname}${target.search}` : address;
    } catch {
        return address;
    }
}

// The address to show: a path of the server is completed with it (null while the server is not known).
export function fromStoredAddress(address: string | null, baseUrl: string | null): string | null {
    if (address === null || !address.startsWith('/')) {
        return address;
    }
    return baseUrl === null ? null : `${baseUrl.replace(/\/$/, '')}${address}`;
}
