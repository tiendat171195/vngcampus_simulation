import { healthResponseSchema } from '@campus/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('api', () => {
  const app = buildApp();
  afterAll(() => app.close());

  it('reports health in the shared shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.service).toBe('api');
  });

  it('answers unknown routes with 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
  });
});
