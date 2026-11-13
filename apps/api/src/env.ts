import { z } from 'zod';

/** "a.com, B.com" → ["a.com", "b.com"]. */
const list = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

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
  /** Address people open the game at; sign-in providers send them back under it. */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** Google sign-in (docs/07 §5.2): an OAuth client of type "Web application". */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Any other OpenID Connect provider, e.g. Microsoft Entra ID or the mock IdP. */
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  /** Button text, e.g. "Microsoft 365". */
  OIDC_LABEL: z.string().default('tài khoản công ty'),
  /** Email domains allowed to sign in with a provider. Empty: any (development only). */
  AUTH_EMAIL_DOMAINS: list,
  /** People who become administrators when they sign in with a provider (docs/07 §5.3). */
  ADMIN_EMAILS: list,
});

export type Env = z.infer<typeof envSchema>;

/** Validates configuration once at startup so a bad value fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.JWT_PRIVATE_KEY) {
    throw new Error('JWT_PRIVATE_KEY is required in production.');
  }
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    throw new Error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.');
  }
  if (env.OIDC_ISSUER && !(env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET)) {
    throw new Error('OIDC_ISSUER needs OIDC_CLIENT_ID and OIDC_CLIENT_SECRET.');
  }
  const anyProvider = Boolean(env.GOOGLE_CLIENT_ID || env.OIDC_ISSUER);
  if (env.NODE_ENV === 'production' && anyProvider && env.AUTH_EMAIL_DOMAINS.length === 0) {
    throw new Error('AUTH_EMAIL_DOMAINS is required in production when sign-in providers are set.');
  }
  return env;
}
