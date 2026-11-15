import { authIdentities, type Db, sessions, users, uuidv7 } from '@campus/db';
import { PRIVACY_NOTICE_VERSION, type SignInProvider } from '@campus/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { emailAllowed, nameFromProfile, type OidcProfile } from '../auth/oidc';
import { revokeFamily, sha256, startSession } from '../auth/sessions';
import { REFRESH_COOKIE, setRefreshCookie } from './auth';
import type { UserRow } from './users';

/** Holds one sign-in attempt between leaving for the provider and coming back. */
const FLOW_COOKIE = 'campus_oidc';
const FLOW_PATH = '/api/v1/auth/oidc';
const FLOW_SECONDS = 600;

/** Why a sign-in did not work, as the splash screen reads it from `?auth_error=`. */
export type SignInFailure =
  | 'cancelled'
  | 'failed'
  | 'expired'
  | 'unverified'
  | 'domain'
  | 'banned'
  | 'unknown';

/** A path on this site that no browser can read as another host. */
const isLocalPath = (value: string) =>
  /^\/(?![/\\])/.test(value) &&
  ![...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 32 || code === 127 || char === '\\';
  });

const startQuery = z.object({
  /**
   * Path to come back to; only paths on this site. No whitespace or control characters either:
   * browsers drop them, so `/<tab>/evil.example` would become `//evil.example`.
   */
  return: z.string().refine(isLocalPath).max(300).optional(),
  /** The privacy notice version the person agreed to before leaving, if they did. */
  consent: z.coerce.number().int().optional(),
});

interface Flow {
  provider: SignInProvider;
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  consent: number | null;
}

/** The signed-in user of a valid refresh cookie, without using it up. */
async function currentSession(db: Db, request: FastifyRequest) {
  const token = request.cookies[REFRESH_COOKIE];
  if (!token) return null;
  const [row] = await db
    .select({ familyId: sessions.familyId, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.refreshHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/**
 * Finds or makes the account for a provider identity (docs/07 §5.2):
 * 1. the identity is known → its account;
 * 2. a company account already has this email → add the identity to it;
 * 3. the browser is signed in as a guest → the guest becomes this company account, keeping
 *    everything it earned;
 * 4. otherwise a new account.
 */
async function resolveUser(
  db: Db,
  provider: SignInProvider,
  profile: OidcProfile & { email: string },
  guest: UserRow | null,
  adminEmails: readonly string[],
): Promise<UserRow> {
  const name = nameFromProfile(profile);
  return db.transaction(async (tx) => {
    const [known] = await tx
      .select({ user: users })
      .from(authIdentities)
      .innerJoin(users, eq(users.id, authIdentities.userId))
      .where(
        and(eq(authIdentities.provider, provider), eq(authIdentities.subject, profile.subject)),
      );
    let user = known?.user;
    if (!user) {
      const [sameEmail] = await tx.select().from(users).where(eq(users.email, profile.email));
      if (sameEmail?.isGuest === false) user = sameEmail;
    }
    if (!user && guest) {
      // A recovery code is weaker than a company sign-in; it must not open the account now.
      await tx
        .delete(authIdentities)
        .where(and(eq(authIdentities.userId, guest.id), eq(authIdentities.provider, 'guest')));
      user = guest;
    }
    if (!user) {
      const [created] = await tx
        .insert(users)
        .values({ id: uuidv7(), displayName: name, email: profile.email, isGuest: false })
        .returning();
      if (!created) throw new Error('could not create user');
      user = created;
    }
    if (!known)
      await tx
        .insert(authIdentities)
        .values({ id: uuidv7(), userId: user.id, provider, subject: profile.subject });

    // The provider is the source of truth for who this is.
    const promote = adminEmails.includes(profile.email) && user.role === 'player';
    const [updated] = await tx
      .update(users)
      .set({
        displayName: name,
        email: profile.email,
        isGuest: false,
        ...(promote ? { role: 'admin' as const } : {}),
        lastSeenAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    if (!updated) throw new Error('user vanished');
    return updated;
  });
}

export async function oidcRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, keys } = deps;
  const oidc = deps.oidc;
  if (!oidc || oidc.providers.length === 0) return;
  const providers = new Map(oidc.providers.map((provider) => [provider.id, provider]));
  const limit = (max: number) => Math.round(max * (deps.rateLimitScale ?? 1));
  const redirectUri = (id: SignInProvider) =>
    new URL(`${FLOW_PATH}/${id}/callback`, oidc.publicUrl).toString();

  const failTo = (reply: FastifyReply, reason: SignInFailure, returnTo = '/') => {
    const target = new URL(returnTo, oidc.publicUrl);
    target.searchParams.set('auth_error', reason);
    return reply.redirect(`${target.pathname}${target.search}`);
  };

  app.get<{ Params: { provider: string } }>(
    '/auth/oidc/:provider/start',
    { config: { rateLimit: { max: limit(30), timeWindow: '1 minute' } } },
    async (request, reply) => {
      const provider = providers.get(request.params.provider as SignInProvider);
      const query = startQuery.safeParse(request.query);
      const returnTo = query.success ? (query.data.return ?? '/') : '/';
      if (!provider) return failTo(reply, 'unknown', returnTo);
      let started: Awaited<ReturnType<typeof provider.start>>;
      try {
        started = await provider.start(redirectUri(provider.id));
      } catch (error) {
        request.log.error(error, 'sign-in provider unreachable');
        return failTo(reply, 'failed', returnTo);
      }
      const flow: Flow = {
        provider: provider.id,
        ...started.transaction,
        returnTo,
        consent: query.success ? (query.data.consent ?? null) : null,
      };
      reply.setCookie(FLOW_COOKIE, await keys.seal({ ...flow }, 'oidc', FLOW_SECONDS), {
        httpOnly: true,
        // Lax: the provider sends the browser back with a top-level GET, which carries it.
        sameSite: 'lax',
        secure: deps.secureCookies,
        path: FLOW_PATH,
        maxAge: FLOW_SECONDS,
      });
      return reply.redirect(started.url.toString());
    },
  );

  app.get<{ Params: { provider: string } }>(
    '/auth/oidc/:provider/callback',
    { config: { rateLimit: { max: limit(30), timeWindow: '1 minute' } } },
    async (request, reply) => {
      const sealed = request.cookies[FLOW_COOKIE];
      reply.clearCookie(FLOW_COOKIE, { path: FLOW_PATH });
      let flow: Flow;
      try {
        if (!sealed) throw new Error('no flow cookie');
        flow = (await keys.unseal(sealed, 'oidc')) as unknown as Flow;
      } catch {
        // Took more than ten minutes, or came back in another browser.
        return failTo(reply, 'expired');
      }
      const provider = providers.get(flow.provider);
      if (!provider || provider.id !== request.params.provider)
        return failTo(reply, 'failed', flow.returnTo);

      // The person closed the provider's page or said no.
      if ((request.query as Record<string, unknown>).error === 'access_denied')
        return failTo(reply, 'cancelled', flow.returnTo);
      let profile: OidcProfile;
      try {
        const callbackUrl = new URL(redirectUri(provider.id));
        callbackUrl.search = new URL(request.url, oidc.publicUrl).search;
        profile = await provider.finish(callbackUrl, flow);
      } catch (error) {
        request.log.warn({ err: error }, 'sign-in rejected');
        return failTo(reply, 'failed', flow.returnTo);
      }
      if (!profile.email || !profile.emailVerified)
        return failTo(reply, 'unverified', flow.returnTo);
      if (!emailAllowed(profile.email, oidc.emailDomains))
        return failTo(reply, 'domain', flow.returnTo);

      const current = await currentSession(db, request);
      const user = await resolveUser(
        db,
        provider.id,
        { ...profile, email: profile.email },
        current?.user.isGuest ? current.user : null,
        oidc.adminEmails,
      );
      if (user.status === 'banned') return failTo(reply, 'banned', flow.returnTo);
      if (flow.consent === PRIVACY_NOTICE_VERSION && user.consentVersion !== flow.consent)
        await db.update(users).set({ consentVersion: flow.consent }).where(eq(users.id, user.id));

      // Whoever this browser was signed in as before, it is this person now.
      if (current) await revokeFamily(db, current.familyId);
      const session = await startSession(db, user.id, String(request.headers['user-agent'] ?? ''));
      setRefreshCookie(reply, session, deps.secureCookies);
      return reply.redirect(flow.returnTo);
    },
  );
}
