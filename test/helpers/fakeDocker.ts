import type { DockerResult, DockerRunner } from '@main/services/tools/flaresolverrDocker';

export interface FakeDockerOptions {
    // `docker` cannot be run, or its daemon does not answer.
    dockerMissing?: boolean;
    imagePresent?: boolean;
    pullFails?: boolean;
    runFails?: boolean;
    containerId?: string;
}

const PULL_LINES = [
    'v3.5.2: Pulling from flaresolverr/flaresolverr',
    'aaaaaaaaaaaa: Pulling fs layer',
    'bbbbbbbbbbbb: Pulling fs layer',
    'aaaaaaaaaaaa: Pull complete',
    'bbbbbbbbbbbb: Already exists',
    'Status: Downloaded newer image for ghcr.io/flaresolverr/flaresolverr:v3.5.2'
];

function result(code: number | null, stdout = '', stderr = ''): Promise<DockerResult> {
    return Promise.resolve({ code, stdout, stderr });
}

// A `docker` that answers the way the real one does for the commands the app uses, and keeps every call.
export function fakeDocker(options: FakeDockerOptions = {}): { runner: DockerRunner; calls: string[][] } {
    const calls: string[][] = [];
    let imagePresent = options.imagePresent ?? false;
    const runner: DockerRunner = (args, onLine) => {
        calls.push(args);
        if (options.dockerMissing === true) {
            return result(args[0] === 'version' ? 127 : 1, '', 'docker: command not found');
        }
        switch (args[0]) {
            case 'version':
                return result(0, '27.0.1\n');
            case 'image':
                return imagePresent ? result(0, 'sha256:abc\n') : result(1, '', 'Error: No such image');
            case 'pull':
                if (options.pullFails === true) {
                    return result(1, '', 'Error response from daemon: manifest unknown');
                }
                PULL_LINES.forEach((line) => {
                    onLine?.(line);
                });
                imagePresent = true;
                return result(0, PULL_LINES.join('\n'));
            case 'run':
                return options.runFails === true ? result(125, '', 'docker: port is already allocated') : result(0, `${options.containerId ?? 'c0ffee'}\n`);
            case 'logs':
                return result(0, 'FlareSolverr log line\n');
            default:
                return result(0);
        }
    };
    return { runner, calls };
}
