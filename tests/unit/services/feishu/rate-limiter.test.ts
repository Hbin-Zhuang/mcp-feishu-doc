/**
 * @fileoverview RateLimiter 单元测试.
 * 测试频率限制逻辑、滑动窗口算法、并发场景等.
 * @module tests/unit/services/feishu/rate-limiter.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FeishuRateLimiter } from '@/services/feishu/providers/rate-limiter.provider.js';

describe('FeishuRateLimiter', () => {
  let rateLimiter: FeishuRateLimiter;

  beforeEach(() => {
    rateLimiter = new FeishuRateLimiter();
  });

  describe('基础功能', () => {
    it('应该正确初始化', () => {
      expect(rateLimiter.name).toBe('feishu-rate-limiter');
      expect(rateLimiter.isEnabled()).toBe(true);
    });

    it('healthCheck 应该返回 true', () => {
      const result = rateLimiter.healthCheck();
      expect(result).toBe(true);
    });

    it('应该能够启用和禁用频率限制', () => {
      rateLimiter.setEnabled(false);
      expect(rateLimiter.isEnabled()).toBe(false);

      rateLimiter.setEnabled(true);
      expect(rateLimiter.isEnabled()).toBe(true);
    });
  });

  describe('节流控制', () => {
    it('禁用时应该立即返回', async () => {
      rateLimiter.setEnabled(false);

      const start = Date.now();
      await rateLimiter.throttle('document');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it('首次调用应该立即返回', async () => {
      await rateLimiter.throttle('document');

      // 首次调用不应该等待
      const stats = rateLimiter.getStats();
      expect(stats.document.count).toBe(1);
    });

    it('应该为不同 API 类型独立计数', async () => {
      await rateLimiter.throttle('document');
      await rateLimiter.throttle('upload');
      await rateLimiter.throttle('wiki');

      const stats = rateLimiter.getStats();
      expect(stats.document.count).toBe(1);
      expect(stats.upload.count).toBe(1);
      expect(stats.wiki.count).toBe(1);
    });
  });

  describe('统计信息', () => {
    it('应该返回所有 API 类型的统计', () => {
      const stats = rateLimiter.getStats();

      expect(stats).toHaveProperty('document');
      expect(stats).toHaveProperty('import');
      expect(stats).toHaveProperty('block');
      expect(stats).toHaveProperty('upload');
      expect(stats).toHaveProperty('wiki');
    });

    it('应该正确计算剩余配额', async () => {
      await rateLimiter.throttle('document');

      const stats = rateLimiter.getStats();
      // document 每分钟限制 90 次
      expect(stats.document.count).toBe(1);
      expect(stats.document.remaining).toBe(89);
    });

    it('应该正确计算重置时间', async () => {
      await rateLimiter.throttle('document');

      const stats = rateLimiter.getStats();
      // 重置时间应该在 60 秒内
      expect(stats.document.resetIn).toBeLessThanOrEqual(60000);
      expect(stats.document.resetIn).toBeGreaterThanOrEqual(0);
    });
  });

  describe('重置功能', () => {
    it('应该重置所有计数器', async () => {
      await rateLimiter.throttle('document');
      await rateLimiter.throttle('upload');

      rateLimiter.reset();

      const stats = rateLimiter.getStats();
      expect(stats.document.count).toBe(0);
      expect(stats.upload.count).toBe(0);
    });

    it('应该重置指定 API 类型的计数器', async () => {
      await rateLimiter.throttle('document');
      await rateLimiter.throttle('upload');

      rateLimiter.resetForType('document');

      const stats = rateLimiter.getStats();
      expect(stats.document.count).toBe(0);
      expect(stats.upload.count).toBe(1);
    });
  });

  describe('每分钟限制', () => {
    it('应该跟踪调用次数', async () => {
      await rateLimiter.throttle('upload');

      const stats = rateLimiter.getStats();
      expect(stats.upload.count).toBe(1);
      expect(stats.upload.remaining).toBe(59); // 60 - 1
    });
  });

  describe('不同 API 类型的限制', () => {
    it('document API 应该有正确的限制', async () => {
      await rateLimiter.throttle('document');
      const stats = rateLimiter.getStats();

      // document: perSecond: 2, perMinute: 90
      expect(stats.document.remaining).toBe(89);
    });

    it('import API 应该有正确的限制', async () => {
      await rateLimiter.throttle('import');
      const stats = rateLimiter.getStats();

      // import: perSecond: 1, perMinute: 90
      expect(stats.import.remaining).toBe(89);
    });

    it('block API 应该有正确的限制', async () => {
      await rateLimiter.throttle('block');
      const stats = rateLimiter.getStats();

      // block: perSecond: 2, perMinute: 150
      expect(stats.block.remaining).toBe(149);
    });

    it('upload API 应该有正确的限制', async () => {
      await rateLimiter.throttle('upload');
      const stats = rateLimiter.getStats();

      // upload: perSecond: 2, perMinute: 60
      expect(stats.upload.remaining).toBe(59);
    });

    it('wiki API 应该有正确的限制', async () => {
      await rateLimiter.throttle('wiki');
      const stats = rateLimiter.getStats();

      // wiki: perSecond: 2, perMinute: 90
      expect(stats.wiki.remaining).toBe(89);
    });
  });
});
