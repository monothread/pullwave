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
import { applyTheme, rememberedTheme } from './theme/resolveTheme';

applyTheme(rememberedTheme());

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<StrictMode>{window.api ? <App /> : <BridgeMissing />}</StrictMode>);
}
