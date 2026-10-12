export type ConfigValue = string | number | boolean;

// What the app decides about the server: it listens on this machine only, on a port of its own, and opens no window, no tray
// icon and no web page (it is driven by the app alone, so it does not even fetch its web interface).
// The sites that are behind Cloudflare are read through a FlareSolverr (a program of the app too) when there is one: its address is
// given, or the bypass is left off. With one, the page it gets is also used as the answer when the server's own request, made again with
// the cookies it got, is refused: some sites (HentaiRead) tie the clearance to the way the connection is made and give a 403 to anything but
// a browser.
export function managedSettings(port: number, flareSolverrUrl: string | null = null): Record<string, ConfigValue> {
    return {
        ip: '127.0.0.1',
        port,
        webUIEnabled: false,
        initialOpenInBrowserEnabled: false,
        systemTrayEnabled: false,
        debugLogsEnabled: false,
        flareSolverrEnabled: flareSolverrUrl !== null,
        ...(flareSolverrUrl === null ? {} : { flareSolverrUrl, flareSolverrAsResponseFallback: true })
    };
}

function render(value: ConfigValue): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sets the given `server.*` values in the text of a server.conf and leaves the rest alone (the server keeps its own settings,
// like the list of extension stores, in the same file). A value that is there is replaced, one that is not is added.
export function applyManagedSettings(conf: string, settings: Record<string, ConfigValue>): string {
    let result = conf;
    Object.entries(settings).forEach(([key, value]) => {
        const line = `server.${key} = ${render(value)}`;
        const existing = new RegExp(`^server\\.${escapeRegExp(key)}\\s*=.*$`, 'm');
        if (existing.test(result)) {
            result = result.replace(existing, () => {
                return line;
            });
        } else {
            result = `${result}${result.length === 0 || result.endsWith('\n') ? '' : '\n'}${line}\n`;
        }
    });
    return result;
}
