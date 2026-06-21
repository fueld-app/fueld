/**
 * Vitest setup for the Angular unit-test builder (@angular/build:unit-test).
 *
 * Why: Angular 22 CLI requires real Node >= v22.22.3 / v24.15.0 / v26.0.0
 * (Bun's runtime reports as Node v24.3.0, below the minimum — see scripts/ng.sh).
 * Under real Node 26, `localStorage`/`sessionStorage` are experimental and
 * unavailable to the Node/jsdom test environment unless `--localstorage-file` is
 * passed (Node emits `ExperimentalWarning: localStorage is not available`).
 * Several services (e.g. AuthService.loadMfaSetupRequired / loadUser) read
 * localStorage at construction time, so without this polyfill any test that
 * instantiates them throws `Cannot read properties of undefined (reading 'getItem')`.
 *
 * The `typeof ... === 'undefined'` guard makes this a no-op in environments that
 * already provide Storage (jsdom/browser), so it is safe to always load.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const createStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    };
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: createStorage(),
    configurable: true,
    writable: true,
  });
}