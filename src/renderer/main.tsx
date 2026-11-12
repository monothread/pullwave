import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BridgeMissing } from './components/BridgeMissing';
import './theme/cyberpunk.css';
import './theme/themes.css';
import './theme/responsive.css';
import './theme/console.css';
import './theme/bp-shell.css';
import './theme/bp-home.css';
import './theme/bp-library.css';
import './theme/bp-downloads.css';
import './theme/bp-fun.css';
import { applyTheme, rememberedTheme } from './theme/resolveTheme';
import { loadStartCatalogs } from './i18n/catalogs';

applyTheme(rememberedTheme());

// The texts of the languages the window can show at its start are loaded before the first drawing (see loadStartCatalogs).
void loadStartCatalogs(window.api ? window.api.getSettings : null).finally(() => {
    const container = document.getElementById('root');
    if (container) {
        createRoot(container).render(<StrictMode>{window.api ? <App /> : <BridgeMissing />}</StrictMode>);
    }
});
