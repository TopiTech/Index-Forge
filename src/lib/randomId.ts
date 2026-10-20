/**
 * A random identifier that works in every browser context.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts. An application
 * served over plain HTTP (a LAN address, a reverse proxy without TLS) has
 * `crypto` but no `randomUUID`, so calling it throws
 * `TypeError: crypto.randomUUID is not a function` and the feature that needed
 * the identifier becomes unusable. `crypto.getRandomValues` exists in every
 * context that exposes `crypto` at all.
 *
 * The identifier is used for owner tokens and record ids. Owner tokens are
 * secrets, so the fallback branch (no Web Crypto at all) is only reached in
 * environments that cannot produce randomness — it must never be used where
 * unpredictability matters, and the Worker always has Web Crypto.
 */
export function safeRandomId(byteLength = 16): string {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(byteLength));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  fallbackCounter += 1;
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

/** Monotonic counter for the no-Web-Crypto fallback. */
let fallbackCounter = 0;
