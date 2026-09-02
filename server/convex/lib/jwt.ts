// Minimal JWT on WebCrypto: RS256 verify against a JWKS (GitHub Actions OIDC),
// RS256 sign with a PEM private key (GitHub App JWT), and HS256 sign/verify
// (the per-run bearer token the action sends back to us). Hand-rolled rather
// than pulling in jose so nothing here depends on how Convex bundles a
// package's node/browser export conditions.

import {
  base64ToBytes,
  base64UrlToBytes,
  base64UrlToUtf8,
  bytesToBase64Url,
  utf8ToBase64Url,
} from "./base64";

const encoder = new TextEncoder();

export type Claims = Record<string, unknown> & { exp?: number; iat?: number };

function splitJwt(token: string): [string, string, string] {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  return parts as [string, string, string];
}

/** read a JWT's claims WITHOUT verifying it. only for freshness hints. */
export function decodeClaims(token: string): Claims {
  const [, payload] = splitJwt(token);
  return JSON.parse(base64UrlToUtf8(payload)) as Claims;
}

function assertTimeClaims(claims: Claims, skewSeconds = 60): void {
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp + skewSeconds < now) {
    throw new Error("JWT expired");
  }
  if (typeof claims.nbf === "number" && claims.nbf - skewSeconds > now) {
    throw new Error("JWT not yet valid");
  }
}

// ── HS256 ────────────────────────────────────────────────────────────────────

async function hmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

export async function signHs256(claims: Claims, secret: string): Promise<string> {
  const header = utf8ToBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = utf8ToBase64Url(JSON.stringify(claims));
  const input = `${header}.${payload}`;
  const key = await hmacKey(secret, "sign");
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(input)));
  return `${input}.${bytesToBase64Url(sig)}`;
}

export async function verifyHs256(token: string, secret: string): Promise<Claims> {
  const [header, payload, signature] = splitJwt(token);
  const alg = (JSON.parse(base64UrlToUtf8(header)) as { alg?: string }).alg;
  if (alg !== "HS256") throw new Error(`unexpected alg ${alg}`);
  const key = await hmacKey(secret, "verify");
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signature),
    encoder.encode(`${header}.${payload}`)
  );
  if (!ok) throw new Error("bad JWT signature");
  const claims = JSON.parse(base64UrlToUtf8(payload)) as Claims;
  assertTimeClaims(claims);
  return claims;
}

// ── RS256 sign (GitHub App JWT) ──────────────────────────────────────────────

/** wrap a PKCS#1 RSAPrivateKey DER in the PKCS#8 envelope WebCrypto wants.
 * GitHub hands out App keys as `BEGIN RSA PRIVATE KEY` (PKCS#1). */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const derLength = (n: number): number[] => {
    if (n < 0x80) return [n];
    const bytes: number[] = [];
    let v = n;
    while (v > 0) {
      bytes.unshift(v & 0xff);
      v >>= 8;
    }
    return [0x80 | bytes.length, ...bytes];
  };
  const octetString = [0x04, ...derLength(pkcs1.length)];
  // SEQUENCE { INTEGER 0, SEQUENCE { OID 1.2.840.113549.1.1.1, NULL } }
  const versionAndAlgorithm = [
    0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const bodyLength = versionAndAlgorithm.length + octetString.length + pkcs1.length;
  const out = new Uint8Array([
    0x30,
    ...derLength(bodyLength),
    ...versionAndAlgorithm,
    ...octetString,
    ...pkcs1,
  ]);
  return out;
}

let cachedSigningKey: { pem: string; key: Promise<CryptoKey> } | undefined;

function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  if (cachedSigningKey?.pem === pem) return cachedSigningKey.key;
  const normalized = pem.replace(/\\n/g, "\n").trim();
  const isPkcs1 = normalized.includes("BEGIN RSA PRIVATE KEY");
  const body = normalized
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(body);
  const pkcs8 = isPkcs1 ? pkcs1ToPkcs8(der) : der;
  const key = crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  cachedSigningKey = { pem, key };
  return key;
}

export async function signRs256(claims: Claims, privateKeyPem: string): Promise<string> {
  const header = utf8ToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = utf8ToBase64Url(JSON.stringify(claims));
  const input = `${header}.${payload}`;
  const key = await importRsaPrivateKey(privateKeyPem);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(input))
  );
  return `${input}.${bytesToBase64Url(sig)}`;
}

// ── RS256 verify against a JWKS ──────────────────────────────────────────────

interface Jwk extends JsonWebKey {
  kid?: string;
}

const jwksCache = new Map<string, { fetchedAt: number; keys: Jwk[] }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

async function loadJwks(url: string, forceRefresh = false): Promise<Jwk[]> {
  const cached = jwksCache.get(url);
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(url, { fetchedAt: Date.now(), keys });
  return keys;
}

export interface VerifyRs256Options {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

export async function verifyRs256(token: string, options: VerifyRs256Options): Promise<Claims> {
  const [header, payload, signature] = splitJwt(token);
  const { alg, kid } = JSON.parse(base64UrlToUtf8(header)) as { alg?: string; kid?: string };
  if (alg !== "RS256") throw new Error(`unexpected alg ${alg}`);

  // an unknown kid usually means GitHub rotated keys; refetch once before failing.
  let jwk = (await loadJwks(options.jwksUrl)).find((k) => k.kid === kid);
  if (!jwk) jwk = (await loadJwks(options.jwksUrl, true)).find((k) => k.kid === kid);
  if (!jwk) throw new Error(`no JWKS key with kid ${kid}`);

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signature),
    encoder.encode(`${header}.${payload}`)
  );
  if (!ok) throw new Error("bad JWT signature");

  const claims = JSON.parse(base64UrlToUtf8(payload)) as Claims;
  if (claims.iss !== options.issuer) throw new Error(`unexpected issuer ${String(claims.iss)}`);
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(options.audience) : aud === options.audience;
  if (!audOk) throw new Error(`unexpected audience ${String(aud)}`);
  assertTimeClaims(claims);
  return claims;
}
