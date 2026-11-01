import { defineConfig } from '@playwright/test';

// Every test opens its own application, with its own temporary folders, and the fake servers listen on free ports: the tests run side by side,
// also the ones of the same file, on a quarter of the cores of the machine (PW_WORKERS sets another number, e.g. 1 to watch them one at a
// time). On every core, and on half of them, the machine was overloaded (each test has its application, its fake programs and ffmpeg) and the
// tests ran out of time (D-133).
const WORKERS = process.env.PW_WORKERS ?? '25%';

// Where the windows of the tests open (see e2eDisplay in src/main/index.ts): the tests that resize the window or the screen need room, so
// they run on the primary monitor; every other test runs on the secondary one, out of the way. The monitor each project uses is its
// `metadata.display`, which test/e2e/display.ts hands to the application.
// Only the layout and the design audits resize the real window, up to 1920 pixels, which does not fit the secondary monitor. The tests that only set the
// size the window already has (the buttons of each theme) do not need the primary one.
const RESIZING_FILES = ['**/layout.e2e-spec.ts', '**/design.e2e-spec.ts'];
// The tests in the other files that resize are tagged with this in their title (or the title of their describe).
const RESIZE_TAG = /@resize/;

export default defineConfig({
    testDir: 'test/e2e',
    testMatch: '**/*.e2e-spec.ts',
    // Side by side every test is a little slower than alone: a cut or a download with ffmpeg needs room.
    timeout: 60000,
    fullyParallel: true,
    workers: WORKERS,
    reporter: 'list',
    projects: [
        { name: 'primary-files', testMatch: RESIZING_FILES, metadata: { display: 'primary' } },
        // These put the window in fullscreen or maximize it: any other window that opens takes it from them, so they run one at a time and
        // alone, after the others (`npm run test:e2e` runs this project in a second step).
        { name: 'primary-tagged', testMatch: ['**/app.e2e-spec.ts', '**/anime.e2e-spec.ts'], grep: RESIZE_TAG, workers: 1, metadata: { display: 'primary' } },
        { name: 'secondary', testIgnore: RESIZING_FILES, grepInvert: RESIZE_TAG, metadata: { display: 'secondary' } }
    ]
});
