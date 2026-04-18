/**
 * @fileoverview 飞书集成测试认证辅助工具单元测试.
 * 验证交互式 OAuth 集成测试的门控逻辑.
 * @module tests/unit/integration/feishu/auth-helper.test
 */

import { describe, expect, it } from 'vitest';

import {
  FEISHU_RUN_INTEGRATION_ENV,
  getFeishuIntegrationSkipReason,
  isFeishuIntegrationEnabled,
  shouldRunFeishuIntegrationTests,
} from '../../../integration/feishu/auth-helper.js';

describe('飞书集成测试认证辅助工具', () => {
  it('默认不启用交互式飞书集成测试', () => {
    expect(isFeishuIntegrationEnabled(undefined)).toBe(false);
    expect(isFeishuIntegrationEnabled('false')).toBe(false);
    expect(isFeishuIntegrationEnabled('true')).toBe(true);
  });

  it('只有在凭证存在且显式开启时才运行交互式飞书集成测试', () => {
    expect(shouldRunFeishuIntegrationTests(false, 'true')).toBe(false);
    expect(shouldRunFeishuIntegrationTests(true, undefined)).toBe(false);
    expect(shouldRunFeishuIntegrationTests(true, 'true')).toBe(true);
  });

  it('应给出准确的跳过原因', () => {
    expect(
      getFeishuIntegrationSkipReason({
        hasCredentials: false,
        isEnabled: true,
      }),
    ).toContain('缺少飞书凭证配置');

    expect(
      getFeishuIntegrationSkipReason({
        hasCredentials: true,
        isEnabled: false,
      }),
    ).toContain(`${FEISHU_RUN_INTEGRATION_ENV}=true`);

    expect(
      getFeishuIntegrationSkipReason({
        hasCredentials: true,
        isEnabled: true,
      }),
    ).toBeNull();
  });
});
