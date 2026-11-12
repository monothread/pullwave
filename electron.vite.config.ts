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
        // The code of the window is minified: less to read and compile each time the app opens. The CSS is left as it is written, so the look
        // of the app is exactly the one of the style sheets.
        build: { minify: true, cssMinify: false }
    }
});
