import { isAvatar } from '@campus/shared';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

export interface Identity {
  userId: string;
  name: string;
  /** Guests are labelled so nobody mistakes one for a colleague (docs/09 §6). */
  guest: boolean;
  /** Avatar string, '' until the person makes one. Checked here: tokens are signed by the API. */
  avatar: string;
  /** Asked to be kept out of the online list (still seen in the world). */
  hidden: boolean;
}

export type TokenVerifier = (token: string) => Promise<Identity>;

/**
 * Checks access tokens issued by the API against the public keys it publishes (docs/07 §5.1).
 * The realtime server never holds a private key, so it cannot mint tokens itself.
 */
export function createTokenVerifier(keys: JWTVerifyGetKey | URL): TokenVerifier {
  const keySet =
    keys instanceof URL ? createRemoteJWKSet(keys, { cooldownDuration: 10_000 }) : keys;
  return async (token) => {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: 'campus-api',
      audience: 'campus',
    });
    if (typeof payload.sub !== 'string' || typeof payload.name !== 'string') {
      throw new Error('token lacks subject or name');
    }
    const avatar =
      typeof payload.avatar === 'string' && isAvatar(payload.avatar) ? payload.avatar : '';
    return {
      userId: payload.sub,
      name: payload.name,
      guest: payload.guest === true,
      avatar,
      hidden: payload.hidden === true,
    };
  };
}
