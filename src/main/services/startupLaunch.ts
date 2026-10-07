// The flag the login entry starts the app with: it is what tells a start by the system at login from one by the person.
export const AUTOSTART_FLAG = '--autostart';

export function isAutostartLaunch(argv: readonly string[]): boolean {
    return argv.includes(AUTOSTART_FLAG);
}

// A restart or a second start must not be taken for the one made at login.
export function withoutAutostartFlag(argv: readonly string[]): string[] {
    return argv.filter((argument) => {
        return argument !== AUTOSTART_FLAG;
    });
}

export interface StartupState {
    autostart: boolean;
    startMinimized: boolean;
}

// Only a start at login can open minimized.
export function shouldStartHidden(state: StartupState): boolean {
    return state.autostart && state.startMinimized;
}
