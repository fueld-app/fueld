import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// ── Chunk-load error recovery ────────────────────────────────────────
// When a new deploy changes JS chunk hashes, the service worker may still
// serve an old index.html that references chunk filenames which no longer
// exist on the server. The dynamic import fails, leaving lazy-loaded
// routes (e.g. company detail tabs) blank.
//
// This handler detects such failures and forces a reload with a
// cache-busting query param so the SW falls through to the network and
// picks up the new index.html. A sessionStorage counter prevents infinite
// reload loops if the new deploy is also broken.

const CHUNK_RELOAD_KEY = 'chunk_reload_count';
const MAX_CHUNK_RELOADS = 3;

function isChunkLoadError(msg: string): boolean {
  return (
    msg.includes('Loading chunk') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    // Safari variant
    msg.includes('Importing a module script failed')
  );
}

function handleChunkLoadFailure(): void {
  const count = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? '0');
  if (count >= MAX_CHUNK_RELOADS) {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    document.body.innerHTML = `
      <div style="padding:2rem;font-family:system-ui,sans-serif;text-align:center;color:#333">
        <h2 style="margin-bottom:0.5rem">Update needed</h2>
        <p style="margin-bottom:1rem;color:#666">
          The app was updated. Please close all browser tabs and reopen Fueld.
        </p>
        <button
          onclick="sessionStorage.removeItem('${CHUNK_RELOAD_KEY}');location.href=location.origin"
          style="padding:0.5rem 1.5rem;border:1px solid #ddd;border-radius:8px;background:#f5f5f5;cursor:pointer;font-size:14px"
        >Retry</button>
      </div>`;
    return;
  }
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(count + 1));
  // Cache-busting param forces the SW to fall through to the network
  // instead of serving the stale cached index.html.
  const url = new URL(window.location.href);
  url.searchParams.set('_chunk_reload', Date.now().toString());
  window.location.replace(url.toString());
}

// Synchronous chunk load errors (older webpack-style chunk loading)
window.addEventListener('error', (event) => {
  const msg = event?.message ?? '';
  if (isChunkLoadError(msg)) {
    handleChunkLoadFailure();
  }
});

// Promise rejections from dynamic imports (Angular 19 lazy routes)
window.addEventListener('unhandledrejection', (event) => {
  const reason = String(event?.reason ?? '');
  if (isChunkLoadError(reason)) {
    handleChunkLoadFailure();
  }
});

bootstrapApplication(App, appConfig)
  .then(() => sessionStorage.removeItem(CHUNK_RELOAD_KEY))
  .catch((err) => console.error(err));