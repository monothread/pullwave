import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: __dirname,
    testMatch: '**/*.shots.ts',
    timeout: 900000,
    workers: 1,
    reporter: 'list'
});
