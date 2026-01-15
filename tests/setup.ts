/**
 * @fileoverview Vitest 测试设置文件.
 * 配置全局测试环境和 mock.
 * @module tests/setup
 */

import 'reflect-metadata';
import { vi } from 'vitest';

// Mock logger 以避免测试输出噪音
vi.mock('@/utils/internal/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    notice: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    crit: vi.fn(),
    emerg: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      notice: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      crit: vi.fn(),
      emerg: vi.fn(),
    })),
  },
}));

// Mock requestContextService
vi.mock('@/utils/internal/requestContext.js', () => ({
  requestContextService: {
    createRequestContext: vi.fn((opts) => ({
      requestId: 'test-request-id',
      timestamp: Date.now(),
      operation: opts?.operation || 'test',
      tenantId: opts?.tenantId || 'test-tenant',
    })),
    withAuthInfo: vi.fn((authInfo) => ({
      requestId: 'test-request-id',
      timestamp: Date.now(),
      operation: 'test',
      tenantId: authInfo?.tenantId || 'test-tenant',
      auth: authInfo,
    })),
  },
}));
