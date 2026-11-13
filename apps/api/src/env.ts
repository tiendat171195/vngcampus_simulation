import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().default('postgres://campus:campus@127.0.0.1:5432/campus'),
  /**
   * ES256 private key (PKCS#8 PEM) that signs access tokens. Without it a new key is made at
   * every start, which signs everyone out on restart: fine in development, not in production.
   */
  JWT_PRIVATE_KEY: z.string().optional(),
  /** Who may sign in as a guest (docs/07 §5.2). */
  GUEST_MODE: z.enum(['off', 'limited', 'full']).default('full'),
  /** Multiplies the per-address limits of the sign-in routes, e.g. for an office behind one NAT. */
  RATE_LIMIT_SCALE: z.coerce.number().positive().default(1),
});

export type Env = z.infer<typeof envSchema>;

/** Validates configuration once at startup so a bad value fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.JWT_PRIVATE_KEY) {
    throw new Error('JWT_PRIVATE_KEY is required in production.');
  }
  return parsed.data;
}
