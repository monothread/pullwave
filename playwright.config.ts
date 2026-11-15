import { defineConfig } from '@playwright/test';

const WORKERS = process.env.PW_WORKERS ?? '25%';

const RESIZING_FILES = ['**/layout.e2e-spec.ts', '**/design.e2e-spec.ts', '**/settings-layout.e2e-spec.ts'];
const RESIZE_TAG = /@resize/;

export default defineConfig({
    testDir: 'test/e2e',
    testMatch: '**/*.e2e-spec.ts',
    timeout: 60000,
    fullyParallel: true,
    workers: WORKERS,
    reporter: 'list',
    projects: [
        { name: 'primary-files', testMatch: RESIZING_FILES, metadata: { display: 'primary' } },
        { name: 'primary-tagged', testMatch: ['**/app.e2e-spec.ts', '**/anime.e2e-spec.ts'], grep: RESIZE_TAG, workers: 1, metadata: { display: 'primary' } },
        { name: 'secondary', testIgnore: RESIZING_FILES, grepInvert: RESIZE_TAG, metadata: { display: 'secondary' } }
    ]
});
