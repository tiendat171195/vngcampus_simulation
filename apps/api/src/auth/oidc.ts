import type { SignInProvider } from '@campus/shared';
import * as client from 'openid-client';

/** One sign-in provider as configured (docs/07 §5.2). */
export interface OidcProviderConfig {
  id: SignInProvider;
  /** Button text. */
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
}

/** What the API learns about a person from their provider. */
export interface OidcProfile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Secrets of one sign-in attempt, kept by the browser between leaving and coming back. */
export interface OidcTransaction {
  state: string;
  nonce: string;
  verifier: string;
}

export interface OidcProvider {
  id: SignInProvider;
  label: string;
  /** Where to send the browser, and what to remember for the way back. */
  start(redirectUri: string): Promise<{ url: URL; transaction: OidcTransaction }>;
  /** Checks the provider's answer at `callbackUrl` and reads the person's identity. */
  finish(callbackUrl: URL, transaction: OidcTransaction): Promise<OidcProfile>;
}

/**
 * A provider that loads its discovery document on first use and keeps it; a failed load is
 * retried next time, so the API starts even when a provider is briefly unreachable.
 */
export function createOidcProvider(config: OidcProviderConfig): OidcProvider {
  let discovered: Promise<client.Configuration> | null = null;
  const configuration = () => {
    discovered ??= client
      .discovery(
        new URL(config.issuer),
        config.clientId,
        config.clientSecret,
        undefined,
        // Plain HTTP is only for the mock provider in development and tests.
        config.issuer.startsWith('http://') ? { execute: [client.allowInsecureRequests] } : {},
      )
      .catch((error: unknown) => {
        discovered = null;
        throw error;
      });
    return discovered;
  };

  return {
    id: config.id,
    label: config.label,
    async start(redirectUri) {
      const transaction: OidcTransaction = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        verifier: client.randomPKCECodeVerifier(),
      };
      const url = client.buildAuthorizationUrl(await configuration(), {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(transaction.verifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url, transaction };
    },
    async finish(callbackUrl, transaction) {
      const tokens = await client.authorizationCodeGrant(await configuration(), callbackUrl, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('no ID token');
      return {
        subject: claims.sub,
        email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : null,
      };
    },
  };
}

/** Whether `email` belongs to one of `domains`; an empty list allows any (development). */
export function emailAllowed(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true;
  const at = email.lastIndexOf('@');
  return at > 0 && domains.includes(email.slice(at + 1));
}

/** A display name from what a provider says, within the rules every name follows. */
export function nameFromProfile(profile: OidcProfile): string {
  const cleaned = (profile.name ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  const fallback = profile.email?.split('@')[0] ?? 'Đồng nghiệp';
  return Array.from(cleaned || fallback)
    .slice(0, 24)
    .join('')
    .trim();
}
