/**
 * @fileoverview Streamable HTTP transport implementation using native MCP SDK.
 * This provides SSE support compatible with Kiro and other MCP clients.
 *
 * @module src/mcp-server/transports/http/streamableHttpTransport
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { html } from 'hono/html';
import http from 'http';
import { container } from 'tsyringe';
import { randomUUID } from 'crypto';
import { config } from '@/config/index.js';
import { FeishuServiceToken } from '@/container/tokens.js';
import { httpErrorHandler } from '@/mcp-server/transports/http/httpErrorHandler.js';
import type {
  HonoNodeBindings,
} from '@/mcp-server/transports/http/httpTypes.js';
import type { FeishuService } from '@/services/feishu/index.js';
import {
  type RequestContext,
  logger,
  logStartupBanner,
} from '@/utils/index.js';

/**
 * 创建支持 Streamable HTTP (SSE) 的 Hono 应用
 */
export function createStreamableHttpApp<TBindings extends object = HonoNodeBindings>(
  mcpServer: McpServer,
  parentContext: RequestContext,
): Hono<{ Bindings: TBindings }> {
  const app = new Hono<{ Bindings: TBindings }>();
  const transportContext = {
    ...parentContext,
    component: 'StreamableHttpTransportSetup',
  };

  // CORS配置
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

  // 错误处理
  app.onError(httpErrorHandler);

  // 健康检查
  app.get('/healthz', (c) => c.json({ status: 'ok', transport: 'streamable-http' }));

  // 飞书 OAuth 授权URL生成端点
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
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <title>飞书授权</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
                .icon { font-size: 64px; margin-bottom: 20px; }
                h1 { color: #0277bd; margin-bottom: 16px; }
                p { color: #6b7280; line-height: 1.6; margin-bottom: 24px; }
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
                .auth-button:hover { background: #01579b; }
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
                <p>点击下面的按钮完成飞书账号授权，授权后即可使用飞书相关功能。</p>
                <a href="${result.authUrl}" class="auth-button">前往飞书授权</a>
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
      return c.html(html`<h1>生成授权URL失败</h1><p>${errorMessage}</p>`, 500);
    }
  });

  // 飞书 OAuth 回调路由
  app.get('/oauth/feishu/callback', async (c) => {
    const oauthContext = {
      ...transportContext,
      operation: 'feishuOAuthCallback',
    };

    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');
    const errorDescription = c.req.query('error_description');

    if (error) {
      logger.warning('飞书授权失败', { ...oauthContext, error, errorDescription });
      return c.html(html`<h1>授权失败</h1><p>${errorDescription ?? error}</p>`, 400);
    }

    if (!code || !state) {
      logger.warning('飞书 OAuth 回调缺少必要参数', oauthContext);
      return c.html(html`<h1>参数错误</h1><p>缺少必要参数</p>`, 400);
    }

    try {
      const feishuService = container.resolve<FeishuService>(FeishuServiceToken as symbol);
      const result = await feishuService.handleAuthCallback(code, state);

      if (!result.success) {
        throw new Error('授权回调处理失败');
      }

      logger.info('飞书授权成功', { ...oauthContext, userName: result.userInfo?.name });

      return c.html(
        html`<!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8" />
              <title>飞书授权成功</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
                .icon { font-size: 64px; margin-bottom: 20px; }
                h1 { color: #059669; margin-bottom: 16px; }
                p { color: #6b7280; line-height: 1.6; }
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
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">✅</div>
                <h1>授权成功</h1>
                <p>您已成功授权飞书账号，现在可以使用飞书相关功能了。</p>
                ${result.userInfo ? html`<div class="user-info"><div class="user-name">欢迎，${result.userInfo.name}！</div></div>` : ''}
                <p style="margin-top: 24px; font-size: 14px; color: #9ca3af;">您可以关闭此页面</p>
              </div>
            </body>
          </html>`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('飞书授权回调处理失败', err instanceof Error ? err : new Error(errorMessage), oauthContext);
      return c.html(html`<h1>授权处理失败</h1><p>${errorMessage}</p>`, 500);
    }
  });

  // 创建传输实例 - 根据配置选择有状态或无状态模式
  const transport = config.mcpSessionMode === 'stateless'
    ? new StreamableHTTPServerTransport()
    : new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });

  // 连接到MCP服务器（StreamableHTTPServerTransport 与 SDK Transport 类型兼容）
  void mcpServer.connect(transport as Parameters<McpServer['connect']>[0]).then(() => {
    logger.info('MCP server connected to Streamable HTTP transport', transportContext);
  }).catch((err) => {
    logger.error(
      'Failed to connect MCP server to transport',
      err instanceof Error ? err : new Error(String(err)),
      transportContext,
    );
  });

  // MCP endpoint - 处理所有 GET 和 POST 请求
  app.all(config.mcpHttpEndpointPath, async (c) => {
    logger.debug('Handling MCP request', {
      ...transportContext,
      method: c.req.method,
      path: c.req.path,
    });

    // 获取原始的Node.js请求和响应对象
    const env = c.env as HonoNodeBindings | undefined;
    const req = env?.incoming;
    const res = env?.outgoing;

    if (!req || !res) {
      logger.error('Failed to get Node.js request/response objects', transportContext);
      return c.json({ error: 'Internal server error' }, 500);
    }

    try {
      // 对于 POST 请求，传递已解析的 body
      const parsedBody: unknown =
        c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
      
      // 使用 SDK 的传输处理请求
      await transport.handleRequest(req, res, parsedBody);

      // handleRequest 会直接写入响应，不需要返回
      return undefined;
    } catch (err) {
      logger.error(
        'Failed to handle MCP request',
        err instanceof Error ? err : new Error(String(err)),
        transportContext,
      );
      
      // 如果响应还没有发送，返回错误
      if (!res.headersSent) {
        return c.json({ error: 'Failed to handle request' }, 500);
      }
      return undefined;
    }
  });

  logger.info('Streamable HTTP Hono application setup complete', transportContext);
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
    `Attempting to start Streamable HTTP server on port ${initialPort} with ${maxRetries} retries.`,
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
                logger.info(`Streamable HTTP transport listening at ${serverAddress}`, {
                  ...startContext,
                  port,
                  address: serverAddress,
                });
                logStartupBanner(
                  `\n🚀 MCP Server (Streamable HTTP/SSE) running at: ${serverAddress}`,
                  'http' as 'stdio' | 'http',
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

export async function startStreamableHttpTransport(
  mcpServer: McpServer,
  parentContext: RequestContext,
): Promise<ServerType> {
  const transportContext = {
    ...parentContext,
    component: 'StreamableHttpTransportStart',
  };
  logger.info('Starting Streamable HTTP transport.', transportContext);

  const app = createStreamableHttpApp(mcpServer, transportContext);

  const server = await startHttpServerWithRetry(
    app,
    config.mcpHttpPort,
    config.mcpHttpHost,
    config.mcpHttpMaxPortRetries,
    transportContext,
  );

  logger.info('Streamable HTTP transport started successfully.', transportContext);
  return server;
}

export async function stopStreamableHttpTransport(
  server: ServerType,
  parentContext: RequestContext,
): Promise<void> {
  const operationContext = {
    ...parentContext,
    operation: 'stopStreamableHttpTransport',
    transportType: 'Http-Streamable',
  };
  logger.info('Attempting to stop Streamable HTTP transport...', operationContext);

  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        logger.error('Error closing Streamable HTTP server.', err, operationContext);
        return reject(err);
      }
      logger.info('Streamable HTTP server closed successfully.', operationContext);
      resolve();
    });
  });
}
