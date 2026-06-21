import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminView from './AdminView';
import AboutView from './AboutView';
import { startKeepAlive } from './data/api';
import './index.css';

const savedTheme = localStorage.getItem('lastecho-theme');
if (savedTheme === 'dark' || savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', savedTheme);
}

// /admin is a separate, unlinked surface for the human reviewing outreach
// drafts — not part of the public globe app, so a plain path check is enough
// without pulling in a router dependency.
const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin';
const isAbout = path === '/about';

// Keep the (free-tier) API instance warm on every surface — especially /admin,
// where sends happen — so a cold start doesn't stall the request.
startKeepAlive();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin ? <AdminView /> : isAbout ? <AboutView /> : <App />}
  </React.StrictMode>,
);
