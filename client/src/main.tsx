import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminView from './AdminView';
import './index.css';

// /admin is a separate, unlinked surface for the human reviewing outreach
// drafts — not part of the public globe app, so a plain path check is enough
// without pulling in a router dependency.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isAdmin ? <AdminView /> : <App />}</React.StrictMode>,
);
