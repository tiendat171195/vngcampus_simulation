import type { users } from '@campus/db';
import type { UserDto } from '@campus/shared';

export type UserRow = typeof users.$inferSelect;

export const toUserDto = (user: UserRow): UserDto => ({
  id: user.id,
  displayName: user.displayName,
  isGuest: user.isGuest,
  role: user.role,
  avatar: user.avatar,
  locale: user.locale,
  email: user.email,
  consentVersion: user.consentVersion,
});

/** Claims of an access token for this user in session `sid`. */
export const claimsFor = (user: UserRow, sid: string) => ({
  sub: user.id,
  name: user.displayName,
  role: user.role,
  guest: user.isGuest,
  avatar: user.avatar,
  sid,
});
