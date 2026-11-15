export const AUTOSTART_FLAG = '--autostart';

export function isAutostartLaunch(argv: readonly string[]): boolean {
    return argv.includes(AUTOSTART_FLAG);
}

export function withoutAutostartFlag(argv: readonly string[]): string[] {
    return argv.filter((argument) => {
        return argument !== AUTOSTART_FLAG;
    });
}

export interface StartupState {
    autostart: boolean;
    startMinimized: boolean;
}

export function shouldStartHidden(state: StartupState): boolean {
    return state.autostart && state.startMinimized;
}
