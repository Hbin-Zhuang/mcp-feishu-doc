/**
 * @fileoverview Hybrid transport: stdio for MCP + HTTP for OAuth callbacks
 * This allows Kiro to communicate via stdio while OAuth callbacks work via HTTP
 *
 * @module src/mcp-server/transports/hybrid/hybridTransport
 */
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { html } from 'hono/html';
import { container } from 'tsyringe';

import { config } from '@/config/index.js';
import { FeishuServiceToken } from '@/container/tokens.js';
import { httpErrorHandler } from '@/mcp-server/transports/http/httpErrorHandler.js';
import type { HonoNodeBindings } from '@/mcp-server/transports/http/httpTypes.js';
import type { FeishuService } from '@/services/feishu/index.js';
import {
  type RequestContext,
  logger,
} from '@/utils/index.js';

/**
 * 创建仅用于 OAuth 回调的 HTTP 服务器
 */
export function createOAuthCallbackApp<TBindings extends object = HonoNodeBindings>(
  parentContext: RequestContext,
): Hono<{ Bindings: TBindings }> {
  const app = new Hono<{ Bindings: TBindings }>();
  const transportContext = {
    ...parentContext,
    component: 'OAuthCallbackServer',
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
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      credentials: true,
    }),
  );

  // 错误处理
  app.onError(httpErrorHandler);

  // 健康检查
  app.get('/healthz', (c) => c.json({ status: 'ok', purpose: 'oauth-callback' }));

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
      return c.html(
        html`<!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8" />
              <title>授权失败</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
                .icon { font-size: 64px; margin-bottom: 20px; }
                h1 { color: #dc2626; margin-bottom: 16px; }
                p { color: #6b7280; line-height: 1.6; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">❌</div>
                <h1>授权失败</h1>
                <p>${errorDescription ?? error ?? '未知错误'}</p>
              </div>
            </body>
          </html>`,
        400,
      );
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
              <title>授权成功</title>
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

  logger.info('OAuth callback server setup complete', transportContext);
  return app;
}

/**
 * 启动 OAuth 回调服务器（后台运行）
 */
export function startOAuthCallbackServer(
  parentContext: RequestContext,
): ServerType {
  const transportContext = {
    ...parentContext,
    component: 'OAuthCallbackServer',
  };

  logger.info('Starting OAuth callback server...', transportContext);

  const app = createOAuthCallbackApp(transportContext);

  const server = serve(
    {
      fetch: app.fetch,
      port: config.mcpHttpPort,
      hostname: config.mcpHttpHost,
    },
    (info) => {
      logger.info(`OAuth callback server listening at http://${info.address}:${info.port}`, {
        ...transportContext,
        port: info.port,
        address: `http://${info.address}:${info.port}`,
      });
    },
  );

  logger.info('OAuth callback server started successfully', transportContext);
  return server;
}

/**
 * 停止 OAuth 回调服务器
 */
export async function stopOAuthCallbackServer(
  server: ServerType,
  parentContext: RequestContext,
): Promise<void> {
  const operationContext = {
    ...parentContext,
    operation: 'stopOAuthCallbackServer',
  };
  logger.info('Stopping OAuth callback server...', operationContext);

  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        logger.error('Error closing OAuth callback server', err, operationContext);
        return reject(err);
      }
      logger.info('OAuth callback server closed successfully', operationContext);
      resolve();
    });
  });
}
