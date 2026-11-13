import type { FastifyRequest } from 'fastify';
import type { AccessClaims, KeyRing } from '../auth/keys';
import { ApiError } from '../errors';

/** Pre-handler for routes that need a signed-in person: checks the Bearer access token. */
export function requireUser(keys: KeyRing) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new ApiError(401, 'unauthorized', 'Cần đăng nhập.');
    try {
      request.auth = await keys.verify(token);
    } catch {
      throw new ApiError(401, 'unauthorized', 'Phiên đăng nhập đã hết hạn.');
    }
  };
}

export const claimsOf = (request: FastifyRequest): AccessClaims => {
  if (!request.auth) throw new ApiError(401, 'unauthorized', 'Cần đăng nhập.');
  return request.auth;
};
