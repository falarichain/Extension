/** In-memory chrome.storage mock for Vite dev (non-extension) runs. */
export function installDevChromeMock(): void {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) return;

  const localStore = new Map<string, unknown>();
  const sessionStore = new Map<string, unknown>();

  const storageArea = (store: Map<string, unknown>) => ({
    get: (keys?: string | string[] | Record<string, unknown> | null) =>
      new Promise<Record<string, unknown>>((resolve) => {
        if (keys == null) {
          resolve(Object.fromEntries(store));
          return;
        }
        if (typeof keys === 'string') {
          resolve(store.has(keys) ? { [keys]: store.get(keys) } : {});
          return;
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (store.has(key)) result[key] = store.get(key);
          }
          resolve(result);
          return;
        }
        const result: Record<string, unknown> = {};
        for (const [key, defaultValue] of Object.entries(keys)) {
          result[key] = store.has(key) ? store.get(key) : defaultValue;
        }
        resolve(result);
      }),
    set: (items: Record<string, unknown>) =>
      new Promise<void>((resolve) => {
        for (const [key, value] of Object.entries(items)) store.set(key, value);
        resolve();
      }),
    remove: (keys: string | string[]) =>
      new Promise<void>((resolve) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) store.delete(key);
        resolve();
      }),
  });

  (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
    storage: {
      local: storageArea(localStore),
      session: storageArea(sessionStore),
    },
    tabs: { query: async () => [{ windowId: 1 }] },
    sidePanel: { open: async () => {} },
    runtime: { onInstalled: { addListener: () => {} }, onMessage: { addListener: () => {} } },
    notifications: { create: async () => {} },
  } as unknown as typeof chrome;
}
