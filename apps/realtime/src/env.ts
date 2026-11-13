import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REALTIME_HOST: z.string().default('127.0.0.1'),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  /**
   * `on` also lets clients join with a self-chosen identity and no token: load-test bots and
   * tests. Never on a server reachable from the internet.
   */
  DEV_GUEST_AUTH: z.enum(['on', 'off']).optional(),
  /** `on` honours `?spawn=<poi id>` from the client. Default: like DEV_GUEST_AUTH. */
  DEV_SPAWN: z.enum(['on', 'off']).optional(),
  /** Missions and progress (docs/06). Unreachable: the campus runs without missions. */
  DATABASE_URL: z.string().default('postgres://campus:campus@127.0.0.1:5432/campus'),
  /** Where the API publishes the keys that sign access tokens. */
  AUTH_JWKS_URL: z.string().url().default('http://127.0.0.1:3001/api/v1/auth/jwks'),
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

/** Choosing where to appear is a development and test convenience; off in production. */
export function devSpawnEnabled(env: Env): boolean {
  return env.DEV_SPAWN ? env.DEV_SPAWN === 'on' : env.NODE_ENV !== 'production';
}
