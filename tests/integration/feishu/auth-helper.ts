/**
 * @fileoverview 交互式认证辅助函数.
 * 提供交互式 OAuth 认证功能，供集成测试使用.
 * @module tests/integration/feishu/auth-helper
 */

import { container } from 'tsyringe';
import { FeishuServiceToken } from '@/container/tokens.js';
import type { FeishuService } from '@/services/feishu/core/FeishuService.js';
import { requestContextService } from '@/utils/index.js';
import { config } from '@/config/index.js';
import * as readline from 'readline';

/**
 * 检查是否已有有效的认证
 */
export async function checkAuthStatus(): Promise<boolean> {
  try {
    const feishuService = container.resolve(
      FeishuServiceToken,
    ) as FeishuService;
    const testContext = requestContextService.createRequestContext({
      operation: 'auth.check',
      tenantId: 'test-tenant',
    });

    return await feishuService.hasValidAuth(
      testContext,
      config.feishu!.defaultAppId!,
    );
  } catch (error) {
    return false;
  }
}

/**
 * 执行交互式 OAuth 认证
 */
export async function performInteractiveAuth(): Promise<void> {
  const feishuService = container.resolve(FeishuServiceToken) as FeishuService;

  console.log('\n🚀 开始交互式 OAuth 认证流程...\n');

  // 步骤 1: 生成授权 URL
  const authResult = await feishuService.getAuthUrl(
    config.feishu!.defaultAppId!,
    config.feishu!.oauthCallbackUrl!,
  );

  console.log('✅ 授权 URL 生成成功！');
  console.log('');
  console.log('🔗 请在浏览器中打开以下链接完成认证：');
  console.log('');
  console.log(`   ${authResult.authUrl}`);
  console.log('');
  console.log('📋 认证步骤：');
  console.log('   1. 点击上面的链接');
  console.log('   2. 使用飞书账号登录');
  console.log('   3. 授权应用访问权限');
  console.log('   4. 等待页面跳转到回调地址');
  console.log('   5. 从回调 URL 中复制 code 参数');
  console.log('');
  console.log(`🔑 State 参数（用于验证）：${authResult.state}`);
  console.log('');

  // 步骤 2: 等待用户输入授权码
  const code = await promptForAuthCode();

  console.log(`📝 使用授权码: ${code.substring(0, 10)}...`);

  // 步骤 3: 处理授权回调
  const callbackResult = await feishuService.handleAuthCallback(
    code,
    authResult.state,
    config.feishu!.defaultAppId!,
  );

  if (!callbackResult.success) {
    throw new Error('OAuth 认证失败');
  }

  console.log('✅ OAuth 认证成功！');
  console.log('');
  if (callbackResult.userInfo) {
    console.log('� 用户信息：');
    console.log(`   姓名: ${callbackResult.userInfo.name}`);
    console.log(`   邮箱: ${callbackResult.userInfo.email}`);
    console.log(`   用户ID: ${callbackResult.userInfo.userId}`);
  }
  console.log('');
  console.log('🎉 认证完成，现在可以运行集成测试了！');
  console.log('');
}

/**
 * 提示用户输入授权码
 */
async function promptForAuthCode(): Promise<string> {
  // 首先检查环境变量
  const envCode = process.env.TEST_AUTH_CODE;
  if (envCode) {
    console.log('📝 使用环境变量中的授权码');
    return envCode;
  }

  // 如果没有环境变量，提示用户输入
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question('请输入从回调 URL 中获取的授权码 (code 参数): ', (answer) => {
      rl.close();

      if (!answer || answer.trim().length === 0) {
        reject(new Error('未提供授权码'));
        return;
      }

      resolve(answer.trim());
    });

    // 设置超时
    setTimeout(() => {
      rl.close();
      reject(new Error('输入超时'));
    }, 120000); // 2分钟超时
  });
}

/**
 * 等待用户确认继续
 */
export async function waitForUserConfirmation(
  message: string = '按 Enter 键继续...',
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(message);
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * 创建测试上下文
 */
export function createTestContext() {
  return requestContextService.createRequestContext({
    operation: 'integration.test',
    tenantId: 'test-tenant',
  });
}

/**
 * 检查是否有飞书凭证配置
 */
export const hasFeishuCredentials = !!(
  config.feishu?.defaultAppId && config.feishu?.defaultAppSecret
);
