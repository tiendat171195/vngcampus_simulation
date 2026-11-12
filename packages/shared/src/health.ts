import { z } from 'zod';

/** Shape returned by every service's health endpoint. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.enum(['api', 'realtime']),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
