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

export function fromStoredAddress(address: string | null, baseUrl: string | null): string | null {
    if (address === null || !address.startsWith('/')) {
        return address;
    }
    return baseUrl === null ? null : `${baseUrl.replace(/\/$/, '')}${address}`;
}
