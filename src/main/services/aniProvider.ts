const API_ADDRESS = /^[A-Za-z_]*api="?https?:\/\/([^/"'\s]+)/m;

export function providerOf(source: string): string | null {
    return API_ADDRESS.exec(source)?.[1]?.toLowerCase() ?? null;
}
