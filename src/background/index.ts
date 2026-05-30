import { ethers } from 'ethers';

// Pending dApp signing requests (in-memory; lost on SW termination — dApp can retry)
const pendingSignRequests = new Map<string, {
  sendResponse: (response: { result?: unknown; error?: string }) => void;
  address: string;
  hash: string;
  origin: string;
}>();

const SESSION_KEY = 'falari_unlocked';

async function isSessionUnlocked(): Promise<boolean> {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY);
    return !!result[SESSION_KEY];
  } catch {
    return false;
  }
}

function generateRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const ENCRYPTED_PREFIX = 'v1:';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function getVaultKey(): Promise<CryptoKey | null> {
  try {
    const result = await chrome.storage.session.get('falari_vault_key_hex');
    const keyHex = result['falari_vault_key_hex'];
    if (!keyHex) return null;
    const rawKey = hexToBytes(keyHex);
    if (rawKey.length !== 32) return null;
    return crypto.subtle.importKey(
      'raw',
      rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer,
      'AES-GCM',
      false,
      ['decrypt'],
    );
  } catch {
    return null;
  }
}

async function vaultDecrypt(key: CryptoKey, ciphertext: string): Promise<string> {
  const raw = ciphertext.slice(ENCRYPTED_PREFIX.length);
  const iv = hexToBytes(raw.slice(0, 24));
  const data = hexToBytes(raw.slice(24));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, key, data.buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(decrypted);
}

async function getDecryptedPrivateKey(address: string): Promise<string | null> {
  const vaultKey = await getVaultKey();
  if (!vaultKey) return null;
  const result = await chrome.storage.local.get(`pk_${address}`);
  const stored = result[`pk_${address}`];
  if (!stored) return null;
  try {
    return await vaultDecrypt(vaultKey, stored);
  } catch {
    return null;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('falari_wallet_state', (result) => {
    if (!result.falari_wallet_state) {
      chrome.storage.local.set({
        falari_wallet_state: {
          accounts: [],
          selectedAccount: null,
          wallets: [],
          agentKeys: [],
          chainNode: {
            url: 'http://localhost:8080',
            label: 'Local Devnet',
          },
        },
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATE') {
    chrome.storage.local.get('falari_wallet_state', (result) => {
      sendResponse(result.falari_wallet_state || null);
    });
    return true;
  }

  if (message.type === 'SET_STATE') {
    chrome.storage.local.set({ falari_wallet_state: message.state }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'NOTIFY') {
    if (message.notification) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: message.notification.title || 'Falari Wallet',
        message: message.notification.message || '',
      });
    }
    sendResponse({ success: true });
    return true;
  }

  // ── dApp: Get Accounts ──
  if (message.type === 'DAPP_GET_ACCOUNTS') {
    (async () => {
      const unlocked = await isSessionUnlocked();
      if (!unlocked) {
        sendResponse({ error: 'locked' });
        return;
      }
      const result = await chrome.storage.local.get('falari_wallet_state');
      const state = result.falari_wallet_state;
      if (!state || !state.accounts || state.accounts.length === 0) {
        sendResponse({ error: 'no_accounts' });
        return;
      }
      const accounts = state.accounts.map((a: { address: string; publicKey: string }) => ({
        address: a.address,
        publicKey: a.publicKey,
      }));
      sendResponse({ result: { accounts, selectedAccount: state.selectedAccount } });
    })();
    return true;
  }

  // ── dApp: Sign Hash (opens approval popup) ──
  if (message.type === 'DAPP_SIGN_HASH') {
    (async () => {
      const unlocked = await isSessionUnlocked();
      if (!unlocked) {
        sendResponse({ error: 'locked' });
        return;
      }
      const { address, hash } = message.params || {};
      if (!address || !hash) {
        sendResponse({ error: 'missing_params: address and hash are required' });
        return;
      }

      const requestId = generateRequestId();
      pendingSignRequests.set(requestId, {
        sendResponse,
        address,
        hash,
        origin: message.origin || sender.origin || 'unknown',
      });

      // Store request details in session storage for the approval popup to read
      await chrome.storage.session.set({
        [`dapp_sign_${requestId}`]: {
          address,
          hash,
          origin: message.origin || sender.origin || 'unknown',
          createdAt: Date.now(),
        },
      });

      // Open approval popup window
      const popupUrl = chrome.runtime.getURL(
        `src/popup/index.html?mode=approval&requestId=${requestId}`,
      );
      chrome.windows.create({
        url: popupUrl,
        type: 'popup',
        width: 400,
        height: 500,
        focused: true,
      });

      // Don't call sendResponse here — it will be called when DAPP_APPROVAL_RESULT arrives
    })();
    return true; // Keep channel open
  }

  // ── dApp: Approval Result (from popup) ──
  if (message.type === 'DAPP_APPROVAL_RESULT') {
    (async () => {
      const { requestId, approved } = message;
      const pending = pendingSignRequests.get(requestId);
      if (!pending) {
        sendResponse({ error: 'request_not_found' });
        return;
      }
      pendingSignRequests.delete(requestId);

      // Clean up session storage
      chrome.storage.session.remove(`dapp_sign_${requestId}`);

      if (!approved) {
        pending.sendResponse({ error: 'rejected' });
        sendResponse({ success: true });
        return;
      }

      // Sign the hash with the private key
      try {
        const privateKey = await getDecryptedPrivateKey(pending.address);
        if (!privateKey) {
          pending.sendResponse({ error: 'private_key_not_found' });
          sendResponse({ success: true });
          return;
        }

        const signingKey = new ethers.SigningKey(privateKey);
        const sig = signingKey.sign(ethers.hexlify(ethers.getBytes(pending.hash)));
        // Return flat hex without 0x prefix: r(64) + s(64) + v(2) = 130 chars
        const flatSig = sig.r.substring(2) + sig.s.substring(2) + sig.v.toString(16).padStart(2, '0');
        pending.sendResponse({ result: { signature: flatSig } });
      } catch (e) {
        pending.sendResponse({ error: `signing_failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      sendResponse({ success: true });
    })();
    return true;
  }
});

export {};
