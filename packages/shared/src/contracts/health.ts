import { z } from 'zod';

/**
 * The health shape, shared so `/status` and the E2E suite parse what the API
 * actually sends.
 */

export const healthCheckSchema = z.object({
  name: z.string(),
  status: z.enum(['ok', 'fail']),
  latencyMs: z.number().int().nonnegative(),
  /** An error MESSAGE when it failed, never a stack: this body is public. */
  detail: z.string().nullable(),
});

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('api'),
  version: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  checks: z.array(healthCheckSchema),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type Health = z.infer<typeof healthSchema>;
