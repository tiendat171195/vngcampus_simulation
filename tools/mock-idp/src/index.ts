import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

/**
 * A tiny OpenID Connect provider for development and tests: sign in as anyone by typing an email
 * address. It implements just what the API uses — discovery, the authorization code flow with
 * PKCE, and ID tokens — and checks what a real provider would (client, redirect URI, verifier).
 * Never run it anywhere reachable from the internet.
 */
export interface MockIdpOptions {
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  clientId?: string;
  clientSecret?: string;
}

export interface MockIdp {
  issuer: string;
  clientId: string;
  clientSecret: string;
  close(): Promise<void>;
}

export interface MockLogin {
  email: string;
  name: string;
  /** Defaults to true. */
  emailVerified?: boolean;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  nonce: string | undefined;
  login: MockLogin;
  expiresAt: number;
}

const AUTH_PARAMS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
] as const;

/** The same address always gets the same subject, as with a real provider. */
export const subjectOf = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24);

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function send(response: ServerResponse, status: number, body: unknown, type = 'application/json') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function loginPage(params: URLSearchParams): string {
  const hidden = AUTH_PARAMS.map(
    (name) => `<input type="hidden" name="${name}" value="${escapeHtml(params.get(name) ?? '')}">`,
  ).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Mock IdP</title>
<style>body{font:16px system-ui;max-width:360px;margin:48px auto;padding:0 16px}
label{display:block;margin:12px 0 4px}input[type=email],input[type=text]{width:100%;padding:8px;box-sizing:border-box}
button{margin-top:16px;padding:10px 16px}</style></head><body>
<h1>Mock IdP</h1><p>Đăng nhập thử bằng bất kỳ email nào. Chỉ dùng khi phát triển.</p>
<form method="post" action="/authorize">${hidden}
<label for="email">Email</label><input id="email" name="email" type="email" required>
<label for="name">Họ tên</label><input id="name" name="name" type="text" required>
<label><input name="email_verified" type="checkbox" value="true" checked> Email đã xác minh</label>
<button type="submit">Đăng nhập</button></form></body></html>`;
}

export async function startMockIdp(options: MockIdpOptions = {}): Promise<MockIdp> {
  const host = options.host ?? '127.0.0.1';
  const clientId = options.clientId ?? 'campus-dev';
  const clientSecret = options.clientSecret ?? 'campus-dev-secret';
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = randomBytes(6).toString('hex');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, PendingCode>();
  let issuer = '';

  const authorize = (params: URLSearchParams, response: ServerResponse) => {
    const redirectUri = params.get('redirect_uri') ?? '';
    if (params.get('client_id') !== clientId || !redirectUri)
      return send(response, 400, { error: 'invalid_client' });
    if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256')
      return send(response, 400, { error: 'unsupported_response_type' });
    const email = params.get('email')?.trim();
    const name = params.get('name')?.trim();
    if (!email || !name) return send(response, 200, loginPage(params), 'text/html; charset=utf-8');

    const code = randomBytes(16).toString('base64url');
    codes.set(code, {
      clientId,
      redirectUri,
      challenge: params.get('code_challenge') ?? '',
      nonce: params.get('nonce') ?? undefined,
      login: { email, name, emailVerified: params.get('email_verified') === 'true' },
      expiresAt: Date.now() + 60_000,
    });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    const state = params.get('state');
    if (state) target.searchParams.set('state', state);
    target.searchParams.set('iss', issuer);
    response.writeHead(302, { location: target.toString() });
    response.end();
  };

  const token = async (request: IncomingMessage, response: ServerResponse) => {
    const form = await readForm(request);
    let id = form.get('client_id');
    let secret = form.get('client_secret');
    const basic = request.headers.authorization?.match(/^Basic (.+)$/)?.[1];
    if (basic) {
      const [user, pass] = Buffer.from(basic, 'base64').toString('utf8').split(':');
      id = decodeURIComponent(user ?? '');
      secret = decodeURIComponent(pass ?? '');
    }
    if (id !== clientId || secret !== clientSecret)
      return send(response, 401, { error: 'invalid_client' });
    const pending = codes.get(form.get('code') ?? '');
    codes.delete(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (
      form.get('grant_type') !== 'authorization_code' ||
      !pending ||
      pending.expiresAt < Date.now() ||
      pending.redirectUri !== form.get('redirect_uri') ||
      pending.challenge !== challenge
    )
      return send(response, 400, { error: 'invalid_grant' });

    const { login } = pending;
    const idToken = await new SignJWT({
      email: login.email,
      email_verified: login.emailVerified ?? true,
      name: login.name,
      ...(pending.nonce ? { nonce: pending.nonce } : {}),
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject(subjectOf(login.email))
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    send(response, 200, {
      access_token: randomBytes(16).toString('base64url'),
      token_type: 'Bearer',
      expires_in: 300,
      id_token: idToken,
    });
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', issuer || 'http://localhost');
    const route = `${request.method} ${url.pathname}`;
    const fail = (error: unknown) => {
      console.error('[mock-idp]', error);
      if (!response.headersSent) send(response, 500, { error: 'server_error' });
    };
    if (route === 'GET /.well-known/openid-configuration')
      return send(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        scopes_supported: ['openid', 'email', 'profile'],
      });
    if (route === 'GET /jwks') return send(response, 200, { keys: [jwk] });
    if (route === 'GET /authorize') return authorize(url.searchParams, response);
    if (route === 'POST /authorize')
      return void readForm(request)
        .then((form) => authorize(form, response))
        .catch(fail);
    if (route === 'POST /token') return void token(request, response).catch(fail);
    send(response, 404, { error: 'not_found' });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const { port } = server.address() as AddressInfo;
  issuer = `http://${host}:${port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
