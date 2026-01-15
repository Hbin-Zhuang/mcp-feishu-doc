/**
 * @fileoverview Configures and starts the HTTP MCP transport using Hono.
 * This implementation uses the official @hono/mcp package for a fully
 * web-standard, platform-agnostic transport layer.
 *
 * Implements MCP Specification 2025-06-18 Streamable HTTP Transport.
 * @see {@link https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http | MCP Streamable HTTP Transport}
 * @module src/mcp-server/transports/http/httpTransport
 */
import { StreamableHTTPTransport } from '@hono/mcp';
import { type ServerType, serve } from '@hono/node-server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { html } from 'hono/html';
import http from 'http';
import { container } from 'tsyringe';

import { config } from '@/config/index.js';
import { FeishuServiceToken } from '@/container/tokens.js';
import {
  authContext,
  createAuthMiddleware,
  createAuthStrategy,
} from '@/mcp-server/transports/auth/index.js';
import { httpErrorHandler } from '@/mcp-server/transports/http/httpErrorHandler.js';
import type { HonoNodeBindings } from '@/mcp-server/transports/http/httpTypes.js';
import { generateSecureSessionId } from '@/mcp-server/transports/http/sessionIdUtils.js';
import {
  SessionStore,
  type SessionIdentity,
} from '@/mcp-server/transports/http/sessionStore.js';
import type { FeishuService } from '@/services/feishu/index.js';
import {
  type RequestContext,
  logger,
  logStartupBanner,
} from '@/utils/index.js';

/**
 * Extends the base StreamableHTTPTransport to include a session ID.
 */
class McpSessionTransport extends StreamableHTTPTransport {
  public sessionId: string;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
  }
}

/**
 * Creates a Hono HTTP application for the MCP server.
 *
 * This function is generic and can create apps with different binding types:
 * - Node.js environments use HonoNodeBindings (default)
 * - Cloudflare Workers use CloudflareBindings
 *
 * The function itself doesn't access bindings; they're only used at runtime
 * when the app processes requests in its specific environment.
 *
 * @template TBindings - The Hono binding type (must extend object, defaults to HonoNodeBindings for Node.js)
 * @param mcpServer - The MCP server instance
 * @param parentContext - Parent request context for logging
 * @returns Configured Hono application with the specified binding type
 */
export function createHttpApp<TBindings extends object = HonoNodeBindings>(
  mcpServer: McpServer,
  parentContext: RequestContext,
): Hono<{ Bindings: TBindings }> {
  const app = new Hono<{ Bindings: TBindings }>();
  const transportContext = {
    ...parentContext,
    component: 'HttpTransportSetup',
  };

  // Initialize session store for stateful mode
  const sessionStore =
    config.mcpSessionMode === 'stateful'
      ? new SessionStore(config.mcpStatefulSessionStaleTimeoutMs)
      : null;

  // CORS (with permissive fallback)
  const allowedOrigin =
    Array.isArray(config.mcpAllowedOrigins) &&
    config.mcpAllowedOrigins.length > 0
      ? config.mcpAllowedOrigins
      : '*';

  app.use(
    '*',
    cors({
      origin: allowedOrigin,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'Mcp-Session-Id',
        'MCP-Protocol-Version',
      ],
      exposeHeaders: ['Mcp-Session-Id'],
      credentials: true,
    }),
  );

  // Centralized error handling
  app.onError(httpErrorHandler);

  // MCP Spec 2025-06-18: Origin header validation for DNS rebinding protection
  // https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning
  app.use(config.mcpHttpEndpointPath, async (c, next) => {
    const origin = c.req.header('origin');
    if (origin) {
      const isAllowed =
        allowedOrigin === '*' ||
        (Array.isArray(allowedOrigin) && allowedOrigin.includes(origin));

      if (!isAllowed) {
        logger.warning('Rejected request with invalid Origin header', {
          ...transportContext,
          origin,
          allowedOrigins: allowedOrigin,
        });
        return c.json(
          { error: 'Invalid origin. DNS rebinding protection.' },
          403,
        );
      }
    }
    // Origin is valid or not present, continue
    return await next();
  });

  // Health and GET /mcp status remain unprotected for convenience
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // 飞书 OAuth 授权URL生成端点（用于测试）
  app.get('/oauth/feishu/auth', async (c) => {
    const authContext = {
      ...transportContext,
      operation: 'feishuGenerateAuthUrl',
    };

    try {
      const feishuService = container.resolve<FeishuService>(
        FeishuServiceToken as symbol,
      );
      const result = await feishuService.getAuthUrl();

      logger.info('生成授权URL成功', {
        ...authContext,
        state: result.state,
      });

      return c.html(
        html`<!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8" />
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
              />
              <title>飞书授权</title>
              <style>
                body {
                  font-family:
                    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                    sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #e0f2fe 0%, #b3e5fc 100%);
                }
                .container {
                  text-align: center;
                  padding: 40px;
                  background: white;
                  border-radius: 16px;
                  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                  max-width: 500px;
                }
                .icon {
                  font-size: 64px;
                  margin-bottom: 20px;
                }
                h1 {
                  color: #0277bd;
                  margin-bottom: 16px;
                }
                p {
                  color: #6b7280;
                  line-height: 1.6;
                  margin-bottom: 24px;
                }
                .auth-button {
                  display: inline-block;
                  background: #0277bd;
                  color: white;
                  padding: 12px 24px;
                  border-radius: 8px;
                  text-decoration: none;
                  font-weight: 600;
                  transition: background-color 0.2s;
                }
                .auth-button:hover {
                  background: #01579b;
                }
                .state-info {
                  background: #f0f9ff;
                  padding: 16px;
                  border-radius: 8px;
                  margin-top: 24px;
                  font-size: 14px;
                  color: #0369a1;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">🔐</div>
                <h1>飞书授权</h1>
                <p>
                  点击下面的按钮完成飞书账号授权，授权后即可使用飞书相关功能。
                </p>
                <a href="${result.authUrl}" class="auth-button">
                  前往飞书授权
                </a>
                <div class="state-info">State: ${result.state}</div>
              </div>
            </body>
          </html>`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        '生成授权URL失败',
        err instanceof Error ? err : new Error(errorMessage),
        authContext,
      );

      return c.html(
        html`<!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8" />
              <title>生成授权URL失败</title>
            </head>
            <body>
              <h1>生成授权URL失败</h1>
              <p>${errorMessage}</p>
            </body>
          </html>`,
        500,
      );
    }
  });

  // 飞书 OAuth 回调路由
  // 处理飞书授权回调，交换授权码获取访问令牌
  app.get('/oauth/feishu/callback', async (c) => {
    const oauthContext = {
      ...transportContext,
      operation: 'feishuOAuthCallback',
    };

    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');
    const errorDescription = c.req.query('error_description');

    logger.debug('收到飞书 OAuth 回调', {
      ...oauthContext,
      hasCode: !!code,
      hasState: !!state,
      hasError: !!error,
    });

    // 处理授权错误
    if (error) {
      logger.warning('飞书授权失败', {
        ...oauthContext,
        error,
        errorDescription,
      });
      return c.html(
        html`<!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8" />
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
              />
              <title>飞书授权失败</title>
              <style>
                body {
                  font-family:
                    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                    sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
                }
                .container {
                  text-align: center;
                  padding: 40px;
                  background: white;
                  border-radius: 16px;
                  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                  max-width: 400px;
                }
                .icon {
                  font-size: 64px;
                  margin-bottom: 20px;
                }
                h1 {
                  color: #dc2626;
                  margin-bottom: 16px;
                }
                p {
                  color: #6b7280;
                  line-height: 1.6;
                }
                .error-code {
                  background: #fef2f2;
                  padding: 12px;
                  border-radius: 8px;
                  margin-top: 16px;
                  font-family: monospace;
                  color: #991b1b;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">❌</div>
                <h1>授权失败</h1>
                <p>飞书授权过程中发生错误，请重新尝试。</p>
                <div class="error-code">
                  ${errorDescription ?? error ?? '未知错误'}
                </div>
              </div>
            </body>
          </html>`,
        400,
      );
    }

    // 验证必要参数
    if (!code || !state) {
      logger.warning('飞书 OAuth 回调缺少必要参数', {
        ...oauthContext,
        hasCode: !!code,
        hasState: !!state,
      });
      return c.html(
        html`<!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8" />
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
              />
              <title>参数错误</title>
              <style>
                body {
                  font-family:
                    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                    sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
                }
                .container {
                  text-align: center;
                  padding: 40px;
                  background: white;
                  border-radius: 16px;
                  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                  max-width: 400px;
                }
                .icon {
                  font-size: 64px;
                  margin-bottom: 20px;
                }
                h1 {
                  color: #d97706;
                  margin-bottom: 16px;
                }
                p {
                  color: #6b7280;
                  line-height: 1.6;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">⚠️</div>
                <h1>参数错误</h1>
                <p>授权回调缺少必要参数，请重新发起授权请求。</p>
              </div>
            </body>
          </html>`,
        400,
      );
    }

    try {
      // 获取 FeishuService 并处理回调
      const feishuService = container.resolve<FeishuService>(
        FeishuServiceToken as symbol,
      );
      const result = await feishuService.handleAuthCallback(code, state);

      if (!result.success) {
        throw new Error('授权回调处理失败');
      }

      logger.info('飞书授权成功', {
        ...oauthContext,
        userName: result.userInfo?.name,
      });

      // 返回成功页面
      return c.html(
        html`<!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8" />
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
              />
              <title>飞书授权成功</title>
              <style>
                body {
                  font-family:
                    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                    sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
                }
                .container {
                  text-align: center;
                  padding: 40px;
                  background: white;
                  border-radius: 16px;
                  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                  max-width: 400px;
                }
                .icon {
                  font-size: 64px;
                  margin-bottom: 20px;
                }
                h1 {
                  color: #059669;
                  margin-bottom: 16px;
                }
                p {
                  color: #6b7280;
                  line-height: 1.6;
                }
                .user-info {
                  background: #f0fdf4;
                  padding: 16px;
                  border-radius: 8px;
                  margin-top: 16px;
                }
                .user-name {
                  font-size: 18px;
                  font-weight: 600;
                  color: #065f46;
                }
                .close-hint {
                  margin-top: 24px;
                  font-size: 14px;
                  color: #9ca3af;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">✅</div>
                <h1>授权成功</h1>
                <p>您已成功授权飞书账号，现在可以使用飞书相关功能了。</p>
                ${result.userInfo
                  ? html`<div class="user-info">
                      <div class="user-name">
                        欢迎，${result.userInfo.name}！
                      </div>
                    </div>`
                  : ''}
                <p class="close-hint">您可以关闭此页面</p>
              </div>
            </body>
          </html>`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        '飞书授权回调处理失败',
        err instanceof Error ? err : new Error(errorMessage),
        oauthContext,
      );

      return c.html(
        html`<!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8" />
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
              />
              <title>授权处理失败</title>
              <style>
                body {
                  font-family:
                    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                    sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
                }
                .container {
                  text-align: center;
                  padding: 40px;
                  background: white;
                  border-radius: 16px;
                  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                  max-width: 400px;
                }
                .icon {
                  font-size: 64px;
                  margin-bottom: 20px;
                }
                h1 {
                  color: #dc2626;
                  margin-bottom: 16px;
                }
                p {
                  color: #6b7280;
                  line-height: 1.6;
                }
                .error-detail {
                  background: #fef2f2;
                  padding: 12px;
                  border-radius: 8px;
                  margin-top: 16px;
                  font-size: 14px;
                  color: #991b1b;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">❌</div>
                <h1>授权处理失败</h1>
                <p>处理授权回调时发生错误，请重新尝试。</p>
                <div class="error-detail">${errorMessage}</div>
              </div>
            </body>
          </html>`,
        500,
      );
    }
  });

  // RFC 9728 Protected Resource Metadata endpoint (MCP 2025-06-18)
  // Must be accessible without authentication for discovery
  // https://datatracker.ietf.org/doc/html/rfc9728
  app.get('/.well-known/oauth-protected-resource', (c) => {
    if (!config.oauthIssuerUrl) {
      logger.debug(
        'OAuth Protected Resource Metadata requested but OAuth not configured',
        transportContext,
      );
      return c.json(
        { error: 'OAuth not configured on this server' },
        { status: 404 },
      );
    }

    const origin = new URL(c.req.url).origin;
    const resourceIdentifier =
      config.mcpServerResourceIdentifier ??
      config.oauthAudience ??
      `${origin}/mcp`;

    // Per RFC 9728, this endpoint provides metadata about the protected resource
    const metadata = {
      resource: resourceIdentifier,
      authorization_servers: [config.oauthIssuerUrl],
      bearer_methods_supported: ['header'],
      resource_signing_alg_values_supported: ['RS256', 'ES256', 'PS256'],
      resource_documentation: `${origin}/docs`,
      ...(config.oauthJwksUri && { jwks_uri: config.oauthJwksUri }),
    };

    // RFC 9728 recommends caching this metadata
    c.header('Cache-Control', 'public, max-age=3600');
    c.header('Content-Type', 'application/json');

    logger.debug('Serving OAuth Protected Resource Metadata', {
      ...transportContext,
      resourceIdentifier,
    });

    return c.json(metadata);
  });

  app.get(config.mcpHttpEndpointPath, (c) => {
    return c.json({
      status: 'ok',
      server: {
        name: config.mcpServerName,
        version: config.mcpServerVersion,
        description: config.mcpServerDescription,
        environment: config.environment,
        transport: config.mcpTransportType,
        sessionMode: config.mcpSessionMode,
      },
    });
  });

  // MCP Spec 2025-06-18: DELETE endpoint for session termination
  // Clients SHOULD send DELETE to explicitly terminate sessions
  // https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management
  app.delete(config.mcpHttpEndpointPath, (c) => {
    const sessionId = c.req.header('mcp-session-id');

    if (!sessionId) {
      logger.warning('DELETE request without session ID', transportContext);
      return c.json({ error: 'Mcp-Session-Id header required' }, 400);
    }

    logger.info('Session termination requested', {
      ...transportContext,
      sessionId,
    });

    // For stateless mode or if session management is disabled, return 405
    if (config.mcpSessionMode === 'stateless' || !sessionStore) {
      return c.json(
        { error: 'Session termination not supported in stateless mode' },
        405,
      );
    }

    // Terminate the session in the store
    sessionStore.terminate(sessionId);

    logger.info('Session terminated successfully', {
      ...transportContext,
      sessionId,
    });

    return c.json({ status: 'terminated', sessionId }, 200);
  });

  // Create auth strategy and middleware if auth is enabled
  const authStrategy = createAuthStrategy();
  if (authStrategy) {
    const authMiddleware = createAuthMiddleware(authStrategy);
    app.use(config.mcpHttpEndpointPath, authMiddleware);
    logger.info(
      'Authentication middleware enabled for MCP endpoint.',
      transportContext,
    );
  } else {
    logger.info(
      'Authentication is disabled; MCP endpoint is unprotected.',
      transportContext,
    );
  }

  // JSON-RPC over HTTP (Streamable)
  app.all(config.mcpHttpEndpointPath, async (c) => {
    const protocolVersion =
      c.req.header('mcp-protocol-version') ?? '2025-03-26';
    logger.debug('Handling MCP request.', {
      ...transportContext,
      path: c.req.path,
      method: c.req.method,
      protocolVersion,
    });

    // Per MCP Spec 2025-06-18: MCP-Protocol-Version header MUST be validated
    // Server MUST respond with 400 Bad Request for unsupported versions
    // We default to 2025-03-26 for backward compatibility if not provided
    const supportedVersions = ['2025-03-26', '2025-06-18'];
    if (!supportedVersions.includes(protocolVersion)) {
      logger.warning('Unsupported MCP protocol version requested.', {
        ...transportContext,
        protocolVersion,
        supportedVersions,
      });
      return c.json(
        {
          error: 'Unsupported MCP protocol version',
          protocolVersion,
          supportedVersions,
        },
        400,
      );
    }

    const providedSessionId = c.req.header('mcp-session-id');
    const sessionId = providedSessionId ?? generateSecureSessionId();

    // Extract identity from auth context (if auth is enabled)
    // This MUST happen before session validation for security
    const authStore = authContext.getStore();
    let sessionIdentity: SessionIdentity | undefined;
    if (authStore?.authInfo) {
      // Build identity object conditionally to satisfy exactOptionalPropertyTypes
      sessionIdentity = {};
      if (authStore.authInfo.tenantId)
        sessionIdentity.tenantId = authStore.authInfo.tenantId;
      if (authStore.authInfo.clientId)
        sessionIdentity.clientId = authStore.authInfo.clientId;
      if (authStore.authInfo.subject)
        sessionIdentity.subject = authStore.authInfo.subject;
    }

    // MCP Spec 2025-06-18: Return 404 for invalid/terminated sessions
    // https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management
    // SECURITY: Validate session WITH identity binding to prevent hijacking
    if (
      sessionStore &&
      providedSessionId &&
      !sessionStore.isValidForIdentity(providedSessionId, sessionIdentity)
    ) {
      logger.warning(
        'Session validation failed - invalid or hijacked session',
        {
          ...transportContext,
          sessionId: providedSessionId,
          requestTenant: sessionIdentity?.tenantId,
          requestClient: sessionIdentity?.clientId,
        },
      );
      return c.json({ error: 'Session not found or expired' }, 404);
    }

    // Create or update session for stateful mode WITH identity binding
    if (sessionStore) {
      sessionStore.getOrCreate(sessionId, sessionIdentity);
    }

    const transport = new McpSessionTransport(sessionId);

    const handleRpc = async (): Promise<Response> => {
      await mcpServer.connect(transport);
      const response = await transport.handleRequest(c);

      // MCP Spec 2025-06-18: For stateful sessions, return Mcp-Session-Id header
      // in InitializeResponse (and all subsequent responses)
      if (response && config.mcpSessionMode === 'stateful') {
        response.headers.set('Mcp-Session-Id', sessionId);
        logger.debug('Added Mcp-Session-Id header to response', {
          ...transportContext,
          sessionId,
        });
      }

      if (response) {
        return response;
      }
      return c.body(null, 204);
    };

    // The auth logic is now handled by the middleware. We just need to
    // run the core RPC logic within the async-local-storage context that
    // the middleware has already populated.
    try {
      const store = authContext.getStore();
      if (store) {
        return await authContext.run(store, handleRpc);
      }
      return await handleRpc();
    } catch (err) {
      // Only close transport on error - success path needs to keep it open
      await transport.close?.().catch((closeErr) => {
        logger.warning('Failed to close transport after error', {
          ...transportContext,
          sessionId,
          error:
            closeErr instanceof Error ? closeErr.message : String(closeErr),
        });
      });
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

  logger.info('Hono application setup complete.', transportContext);
  return app;
}

async function isPortInUse(
  port: number,
  host: string,
  parentContext: RequestContext,
): Promise<boolean> {
  const context = { ...parentContext, operation: 'isPortInUse', port, host };
  logger.debug(`Checking if port ${port} is in use...`, context);
  return new Promise((resolve) => {
    const tempServer = http.createServer();
    tempServer
      .once('error', (err: NodeJS.ErrnoException) =>
        resolve(err.code === 'EADDRINUSE'),
      )
      .once('listening', () => tempServer.close(() => resolve(false)))
      .listen(port, host);
  });
}

function startHttpServerWithRetry<TBindings extends object = HonoNodeBindings>(
  app: Hono<{ Bindings: TBindings }>,
  initialPort: number,
  host: string,
  maxRetries: number,
  parentContext: RequestContext,
): Promise<ServerType> {
  const startContext = {
    ...parentContext,
    operation: 'startHttpServerWithRetry',
  };
  logger.info(
    `Attempting to start HTTP server on port ${initialPort} with ${maxRetries} retries.`,
    startContext,
  );

  return new Promise((resolve, reject) => {
    const tryBind = (port: number, attempt: number) => {
      if (attempt > maxRetries + 1) {
        const error = new Error(
          `Failed to bind to any port after ${maxRetries} retries.`,
        );
        logger.fatal(error.message, { ...startContext, port, attempt });
        return reject(error);
      }

      isPortInUse(port, host, { ...startContext, port, attempt })
        .then((inUse) => {
          if (inUse) {
            logger.warning(`Port ${port} is in use, retrying...`, {
              ...startContext,
              port,
              attempt,
            });
            setTimeout(
              () => tryBind(port + 1, attempt + 1),
              config.mcpHttpPortRetryDelayMs,
            );
            return;
          }

          try {
            const serverInstance = serve(
              { fetch: app.fetch, port, hostname: host },
              (info) => {
                const serverAddress = `http://${info.address}:${info.port}${config.mcpHttpEndpointPath}`;
                logger.info(`HTTP transport listening at ${serverAddress}`, {
                  ...startContext,
                  port,
                  address: serverAddress,
                });
                logStartupBanner(
                  `\n🚀 MCP Server running at: ${serverAddress}`,
                  'http',
                );
              },
            );
            resolve(serverInstance);
          } catch (err: unknown) {
            logger.warning(
              `Binding attempt failed for port ${port}, retrying...`,
              { ...startContext, port, attempt, error: String(err) },
            );
            setTimeout(
              () => tryBind(port + 1, attempt + 1),
              config.mcpHttpPortRetryDelayMs,
            );
          }
        })
        .catch((err) =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
    };

    tryBind(initialPort, 1);
  });
}

export async function startHttpTransport(
  mcpServer: McpServer,
  parentContext: RequestContext,
): Promise<ServerType> {
  const transportContext = {
    ...parentContext,
    component: 'HttpTransportStart',
  };
  logger.info('Starting HTTP transport.', transportContext);

  const app = createHttpApp(mcpServer, transportContext);

  const server = await startHttpServerWithRetry(
    app,
    config.mcpHttpPort,
    config.mcpHttpHost,
    config.mcpHttpMaxPortRetries,
    transportContext,
  );

  logger.info('HTTP transport started successfully.', transportContext);
  return server;
}

export async function stopHttpTransport(
  server: ServerType,
  parentContext: RequestContext,
): Promise<void> {
  const operationContext = {
    ...parentContext,
    operation: 'stopHttpTransport',
    transportType: 'Http',
  };
  logger.info('Attempting to stop http transport...', operationContext);

  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        logger.error('Error closing HTTP server.', err, operationContext);
        return reject(err);
      }
      logger.info('HTTP server closed successfully.', operationContext);
      resolve();
    });
  });
}
