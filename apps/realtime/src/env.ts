import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REALTIME_HOST: z.string().default('127.0.0.1'),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  /** `on` lets clients join with a self-chosen guest identity. Only for development, until P3. */
  DEV_GUEST_AUTH: z.enum(['on', 'off']).optional(),
  /** Channel sizes; defaults come from CHANNEL in @campus/shared. Lowered in tests. */
  CHANNEL_SOFT_CAP: z.coerce.number().int().min(1).optional(),
  CHANNEL_HARD_CAP: z.coerce.number().int().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Development identities are on by default everywhere except production. */
export function devGuestAuthEnabled(env: Env): boolean {
  return env.DEV_GUEST_AUTH ? env.DEV_GUEST_AUTH === 'on' : env.NODE_ENV !== 'production';
}
