import { randomUUID } from 'node:crypto';
import {
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  importJWK,
  importPKCS8,
  type JWK,
  jwtVerify,
  SignJWT,
} from 'jose';

const ALGORITHM = 'ES256';
const ISSUER = 'campus-api';
const AUDIENCE = 'campus';
/** Access tokens are short-lived; the refresh cookie gets a new one (docs/07 §5.1). */
export const ACCESS_TOKEN_SECONDS = 15 * 60;

export interface AccessClaims {
  /** User id. */
  sub: string;
  name: string;
  role: string;
  /** Session id, to tie a token to the session that issued it. */
  sid: string;
}

export interface KeyRing {
  sign(claims: AccessClaims): Promise<string>;
  verify(token: string): Promise<AccessClaims>;
  /** Public keys for other services (the realtime server) to verify tokens with. */
  jwks: { keys: JWK[] };
}

/** Builds the signing key from a PEM, or a fresh one for development. */
export async function createKeyRing(privateKeyPem?: string): Promise<KeyRing> {
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  if (privateKeyPem) {
    privateKey = await importPKCS8(privateKeyPem.replace(/\\n/g, '\n'), ALGORITHM, {
      extractable: true,
    });
    const { d: _secret, ...rest } = await exportJWK(privateKey);
    publicJwk = rest;
  } else {
    const pair = await generateKeyPair(ALGORITHM, { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
  }
  const kid = privateKeyPem ? `key-${publicJwk.x?.slice(0, 8)}` : `dev-${randomUUID().slice(0, 8)}`;
  const jwk: JWK = { ...publicJwk, kid, alg: ALGORITHM, use: 'sig' };
  const publicKey = await importJWK(jwk, ALGORITHM);

  return {
    jwks: { keys: [jwk] },
    sign: (claims) =>
      new SignJWT({ name: claims.name, role: claims.role, sid: claims.sid })
        .setProtectedHeader({ alg: ALGORITHM, kid })
        .setSubject(claims.sub)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
        .sign(privateKey),
    async verify(token) {
      const { payload } = await jwtVerify(token, publicKey, { issuer: ISSUER, audience: AUDIENCE });
      return {
        sub: String(payload.sub),
        name: String(payload.name ?? ''),
        role: String(payload.role ?? 'player'),
        sid: String(payload.sid ?? ''),
      };
    },
  };
}
