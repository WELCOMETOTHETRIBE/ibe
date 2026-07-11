/**
 * Ed25519 signing primitives (Node built-in crypto; no third-party crypto deps,
 * no hard-coded secrets). Used for capability tokens, evidence, provenance
 * attestations, and assurance certificates. Keys are generated at runtime; dev
 * private keys live only in memory or under .ibe/keys (gitignored).
 */

import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPublicKey,
} from 'node:crypto';

export interface KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateEd25519(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Sign bytes/string; returns a base64 signature. */
export function signEd25519(privateKeyPem: string, data: string | Uint8Array): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
  // Ed25519 takes null algorithm (pure EdDSA).
  const sig = nodeSign(null, buf, privateKeyPem);
  return sig.toString('base64');
}

/** Verify a base64 signature. Returns false on any error — fail closed. */
export function verifyEd25519(
  publicKeyPem: string,
  data: string | Uint8Array,
  signatureB64: string,
): boolean {
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
    const sig = Buffer.from(signatureB64, 'base64');
    return nodeVerify(null, buf, publicKeyPem, sig);
  } catch {
    return false;
  }
}

/** Short, stable key id derived from the public key (for audit references). */
export function keyIdOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  // Use a truncated hex of the DER bytes; deterministic per key.
  return `key:${Buffer.from(der).subarray(-8).toString('hex')}`;
}
