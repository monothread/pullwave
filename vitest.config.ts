import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@shared': resolve(__dirname, 'src/shared'),
            '@main': resolve(__dirname, 'src/main'),
            '@renderer': resolve(__dirname, 'src/renderer')
        }
    },
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['test/setup.ts'],
        include: ['test/**/*.test.{ts,tsx}'],
        exclude: ['test/e2e/**'],
        // The tests that open files take longer on the disk of the Windows runner of the release than the 5 s of the default.
        testTimeout: 10_000
    }
});
