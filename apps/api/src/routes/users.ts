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
});
