export type ConfigValue = string | number | boolean;

export function managedSettings(port: number, flareSolverrUrl: string | null = null): Record<string, ConfigValue> {
    return {
        ip: '127.0.0.1',
        port,
        webUIEnabled: false,
        initialOpenInBrowserEnabled: false,
        systemTrayEnabled: false,
        debugLogsEnabled: false,
        kcefEnabled: false,
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
