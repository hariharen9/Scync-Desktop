/** Entry point for the quick-popup window (quick.html). */
import { createRoot } from 'react-dom/client';
import QuickApp from './QuickApp.js';
import '../styles/app.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<QuickApp />);
}
