import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/app.tsx';

// Imported through the module graph rather than <link>, so styles travel with
// the bundle and cannot be forgotten by a template.
import './styles/tokens.css';
import './styles/base.css';
import './styles/card.css';
import './styles/script.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root element to mount into');

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
