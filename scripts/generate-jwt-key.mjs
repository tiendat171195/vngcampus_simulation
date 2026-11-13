// Prints a new JWT_PRIVATE_KEY line for prod.env: an ES256 (P-256) private key as PKCS#8 PEM,
// newlines written as \n. Usage: node scripts/generate-jwt-key.mjs
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
console.log(`JWT_PRIVATE_KEY=${pem.replaceAll('\n', '\\n')}`);
