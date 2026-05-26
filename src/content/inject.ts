/**
 * Injected into the page MAIN world via content script bridge.
 * Creates window.falari provider API for dApps to interact with the Falari wallet.
 */

interface FalariRequest {
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let nextId = 1;
const pending = new Map<number, PendingRequest>();

// Listen for responses from the content script bridge
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'falari-bridge' || data.type !== 'response') return;

  const entry = pending.get(data.requestId);
  if (!entry) return;
  pending.delete(data.requestId);

  if (data.error) {
    entry.reject(new Error(data.error));
  } else {
    entry.resolve(data.result);
  }
});

function request(args: FalariRequest): Promise<unknown> {
  const requestId = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    window.postMessage({
      source: 'falari-inpage',
      type: 'request',
      requestId,
      method: args.method,
      params: args.params,
    }, '*');
  });
}

const provider = {
  isFalari: true as const,
  request,
};

// Freeze to prevent tampering
Object.freeze(provider);

(window as any).falari = provider;

// Dispatch event so dApps know the provider is ready
window.dispatchEvent(new CustomEvent('falari#initialized'));
