/** Entry point for the quick-popup window (quick.html). */
import { createRoot } from 'react-dom/client';
import QuickApp from './QuickApp.js';
import '../styles/app.css';

// Mark the root so the global stylesheet can make this whole window
// transparent (html, body and #root all default to the opaque app background).
document.documentElement.dataset.window = 'quick';
document.body.dataset.window = 'quick';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<QuickApp />);
}
