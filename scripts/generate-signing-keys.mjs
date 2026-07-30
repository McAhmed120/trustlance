/**
 * Generates the platform Ed25519 signing keypair (Sprint 4, Day 16).
 *
 *   node scripts/generate-signing-keys.mjs
 *
 * Prints base64-encoded PEM values to paste into .env. The private key is
 * printed to stdout and never written to disk — piping it into a file inside
 * the repo is exactly the mistake §10.1 warns about.
 */
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
  crv: 'Ed25519',
  extractable: true,
});

const privPem = await exportPKCS8(privateKey);
const pubPem = await exportSPKI(publicKey);
const b64 = (s) => Buffer.from(s).toString('base64');

// Date-stamped so a rotation produces a distinguishable kid, letting old
// records stay verifiable against the key that actually signed them.
const keyId = `trustlance-key-${new Date().toISOString().slice(0, 7)}`;

console.log('\n# Paste into .env (and your host\'s secret store):\n');
console.log(`SIGNING_PRIVATE_KEY=${b64(privPem)}`);
console.log(`SIGNING_PUBLIC_KEY=${b64(pubPem)}`);
console.log(`SIGNING_KEY_ID=${keyId}`);
console.log('\n# Public key (safe to publish — this is what third parties verify with):');
console.log(pubPem);
console.log('# Never commit the private key. Rotating it without keeping the old');
console.log('# public key published would invalidate every historical work record.\n');
