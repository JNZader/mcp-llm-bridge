import type { Hono } from 'hono';

import type { GatewayConfig } from '../../../core/types.js';

export interface AdminShellRouteDeps {
  config: GatewayConfig;
}

export function registerAdminShellRoutes(app: Hono, deps: AdminShellRouteDeps): void {
  const { config } = deps;

  app.get('/v1/admin/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    const parts = authHeader?.split(' ');
    const bearerToken = parts?.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;

    if (bearerToken) {
      const { verifyDashboardJwt } = await import('../../../auth/github-oauth.js');
      const payload = verifyDashboardJwt(bearerToken);
      if (payload) {
        return c.json({
          authMethod: 'github',
          login: payload.login,
          name: payload.name,
          avatar: payload.avatar,
        });
      }
    }

    return c.json({ authMethod: 'token', login: null, name: 'Admin', avatar: null });
  });

  app.get('/v1/admin/security-profile', (c) => {
    return c.json({
      profile: config.securityProfile ?? 'local-dev',
      allowedCategories: ['destructive', 'read', 'generate', 'admin'],
      rateLimit: null,
    });
  });
}
