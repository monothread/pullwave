import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const aliases = {
    '@shared': resolve(__dirname, 'src/shared'),
    '@main': resolve(__dirname, 'src/main'),
    '@renderer': resolve(__dirname, 'src/renderer')
};

export default defineConfig({
    main: {
        resolve: { alias: aliases }
    },
    preload: {
        resolve: { alias: aliases }
    },
    renderer: {
        plugins: [react()],
        resolve: { alias: aliases },
        build: { minify: true, cssMinify: false }
    }
});
