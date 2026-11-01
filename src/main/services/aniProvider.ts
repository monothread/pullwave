// The site ani-cli reads the anime from is written in the script (`base_api="https://hianime.at"`). The ids it gives the anime are the ones of that
// site: when the script moves to another one, the ids of the anime that were added are not comparable with the new ones any more.
const API_ADDRESS = /^[A-Za-z_]*api="?https?:\/\/([^/"'\s]+)/m;

// The host of the site the script reads from, or null when the script does not say.
export function providerOf(source: string): string | null {
    return API_ADDRESS.exec(source)?.[1]?.toLowerCase() ?? null;
}
