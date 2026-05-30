import type { Hono } from 'hono';

import { resetProviderCircuitBreakers } from '../../../circuit-breaker/admin-compat.js';
import type { CostTracker } from '../../../core/cost-tracker.js';

export interface AdminOperationsRouteDeps {
  costTracker?: CostTracker;
}

export function registerAdminOperationsRoutes(
  app: Hono,
  deps: AdminOperationsRouteDeps,
): void {
  app.post('/v1/admin/reset-circuit-breaker/:provider', (c) => {
    try {
      const provider = c.req.param('provider');
      const resetCount = resetProviderCircuitBreakers(provider);

      if (resetCount === 0) {
        return c.json({ error: `No circuit breaker found for: ${provider}`, code: 'NOT_FOUND' }, 404);
      }

      return c.json({
        ok: true,
        provider,
        state: 'CLOSED',
        message: `Circuit breaker for ${provider} has been reset`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.post('/v1/admin/flush-usage', (c) => {
    try {
      const { costTracker } = deps;
      if (!costTracker) {
        return c.json({ error: 'Cost tracker not configured', code: 'NOT_CONFIGURED' }, 404);
      }

      const bufferBefore = costTracker.bufferSize;
      costTracker.flush();
      const bufferAfter = costTracker.bufferSize;

      return c.json({
        ok: true,
        flushed: bufferBefore - bufferAfter,
        remainingBuffer: bufferAfter,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
}
