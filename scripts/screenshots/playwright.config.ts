import { defineConfig } from '@playwright/test';

// The screenshots of the README run as one test, one screen after the other, on the real application (see `npm run screenshots`).
export default defineConfig({
    testDir: __dirname,
    testMatch: '**/*.shots.ts',
    timeout: 900000,
    workers: 1,
    reporter: 'list'
});
