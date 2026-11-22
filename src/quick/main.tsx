/** Entry point for the quick-popup window (quick.html). */
import { createRoot } from 'react-dom/client';
import QuickApp from './QuickApp.js';
import '../styles/app.css';

// Mark the body so the global stylesheet can make this window transparent.
document.body.dataset.window = 'quick';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<QuickApp />);
}
