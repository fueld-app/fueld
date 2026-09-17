import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// ── Chunk-load error recovery ────────────────────────────────────────
// When a new deploy changes JS chunk hashes, the service worker may still
// serve an old index.html that references chunk filenames that no longer
// exist on the server. The dynamic import fails with a ChunkLoadError,
// leaving lazy-loaded routes (e.g. company detail tabs) blank.
// This handler detects such failures and forces a full reload so the
// browser picks up the new index.html with correct chunk references.
let chunkReloadInProgress = false;
window.addEventListener('error', (event) => {
  const msg = event?.message ?? '';
  const filename = event?.filename ?? '';
  if (
    (msg.includes('Loading chunk') || msg.includes('Failed to fetch dynamically imported module') ||
     filename.includes('chunk-')) &&
    !chunkReloadInProgress
  ) {
    chunkReloadInProgress = true;
    console.warn('[App] Chunk load failed — reloading to pick up new deploy');
    window.location.reload();
  }
});

// Also catch unhandled promise rejections from dynamic imports (Angular 19
// lazy routes reject the import promise rather than throwing synchronously).
window.addEventListener('unhandledrejection', (event) => {
  const reason = String(event?.reason ?? '');
  if (
    (reason.includes('Loading chunk') || reason.includes('Failed to fetch dynamically imported module') ||
     reason.includes('error loading dynamically imported module')) &&
    !chunkReloadInProgress
  ) {
    chunkReloadInProgress = true;
    console.warn('[App] Dynamic import failed — reloading to pick up new deploy');
    window.location.reload();
  }
});

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));