import { startMockIdp } from './index';

const idp = await startMockIdp({
  host: process.env.MOCK_IDP_HOST ?? '127.0.0.1',
  port: Number(process.env.MOCK_IDP_PORT ?? 3920),
});
console.log(
  `mock IdP at ${idp.issuer} — client id "${idp.clientId}", secret "${idp.clientSecret}"`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void idp.close().then(() => process.exit(0)));
