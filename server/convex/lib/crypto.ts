// AES-GCM at rest for every stored secret. Convex encrypts its storage too,
// but these rows are OAuth refresh chains for a paid ChatGPT account, so a
// dashboard bug or a data-browser screenshot must not be enough to use them.
//
// key: SECRETS_ENCRYPTION_KEY, 32 random bytes base64-encoded
//      (`openssl rand -base64 32`), set with `npx convex env set`.

import { base64ToBytes, bytesToBase64 } from "./base64";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let cachedKey: Promise<CryptoKey> | undefined;

function loadKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) throw new Error("SECRETS_ENCRYPTION_KEY is not set");
  const bytes = base64ToBytes(raw.trim());
  if (bytes.length !== 32) {
    throw new Error(`SECRETS_ENCRYPTION_KEY must decode to 32 bytes, got ${bytes.length}`);
  }
  cachedKey = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  return cachedKey;
}

export interface Sealed {
  ciphertext: string;
  iv: string;
}

export async function seal(plaintext: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await loadKey();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) };
}

export async function open(sealed: Sealed): Promise<string> {
  const key = await loadKey();
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(sealed.iv) },
    key,
    base64ToBytes(sealed.ciphertext)
  );
  return decoder.decode(pt);
}

/** constant-time string compare for webhook signatures and bearer tokens. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
