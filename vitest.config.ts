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
        testTimeout: 10_000
    }
});
