import { randomBytes } from 'node:crypto';

/** Crockford base32 without look-alike letters: easy to read out and type on a phone. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A 15-character code, shown as XXXXX-XXXXX-XXXXX: 75 bits, enough to look up by hash. */
export function newRecoveryCode(): string {
  const bytes = randomBytes(15);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte % 32];
  return `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(10)}`;
}

/** Normalises what a person typed: case, spaces and dashes do not matter, O/I/L read as 0/1/1. */
export function normaliseRecoveryCode(input: string): string {
  const plain = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return plain.length === 15
    ? `${plain.slice(0, 5)}-${plain.slice(5, 10)}-${plain.slice(10)}`
    : plain;
}
