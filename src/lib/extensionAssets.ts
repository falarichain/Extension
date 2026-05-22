/** Resolve paths under the extension root (e.g. manifest web_accessible / packaged files). */
export function extensionAssetUrl(path: string): string {
  const normalized = path.replace(/^\//, '');
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(normalized);
    }
  } catch {
    // ignore
  }
  return `/${normalized}`;
}
