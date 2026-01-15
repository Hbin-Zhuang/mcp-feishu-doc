/**
 * @fileoverview 飞书 API 频率限制器.
 * 从 feishushare 提取核心逻辑，实现智能频率控制.
 * @module src/services/feishu/providers/rate-limiter.provider
 */

import { injectable } from 'tsyringe';
import { logger, requestContextService } from '@/utils/index.js';

/**
 * API 类型定义.
 */
export type FeishuApiType = 'document' | 'import' | 'block' | 'upload' | 'wiki';

/**
 * 频率限制配置.
 */
interface RateLimitConfig {
  /** 每秒最大请求数 */
  perSecond: number;
  /** 每分钟最大请求数 */
  perMinute: number;
}

/**
 * 频率限制配置映射.
 */
const RATE_LIMITS: Record<FeishuApiType, RateLimitConfig> = {
  document: { perSecond: 2, perMinute: 90 },
  import: { perSecond: 1, perMinute: 90 },
  block: { perSecond: 2, perMinute: 150 },
  upload: { perSecond: 2, perMinute: 60 },
  wiki: { perSecond: 2, perMinute: 90 },
};

/**
 * FeishuRateLimiter class 飞书 API 频率限制器.
 * 实现滑动窗口算法，控制 API 调用频率.
 */
@injectable()
export class FeishuRateLimiter {
  public readonly name = 'feishu-rate-limiter';

  /** 上次调用时间（按 API 类型） */
  private lastCallTime: Map<FeishuApiType, number> = new Map();

  /** 调用计数（按 API 类型） */
  private callCount: Map<FeishuApiType, number> = new Map();

  /** 计数器重置时间（按 API 类型） */
  private resetTime: Map<FeishuApiType, number> = new Map();

  /** 是否启用频率限制 */
  private enabled = true;

  /**
   * setEnabled method 设置是否启用频率限制.
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * isEnabled method 获取是否启用频率限制.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * throttle method 智能节流控制.
   * 根据 API 类型应用不同的频率限制.
   */
  public async throttle(apiType: FeishuApiType): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const limit = RATE_LIMITS[apiType];
    const now = Date.now();
    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.rateLimiter.throttle',
    });

    // 获取当前 API 类型的状态
    const lastCall = this.lastCallTime.get(apiType) ?? 0;
    let count = this.callCount.get(apiType) ?? 0;
    const reset = this.resetTime.get(apiType) ?? 0;

    // 重置计数器（每分钟）
    if (now - reset > 60000) {
      count = 0;
      this.resetTime.set(apiType, now);
    }

    // 检查每分钟限制
    if (count >= limit.perMinute) {
      const waitTime = 60000 - (now - reset);
      logger.debug(
        `频率限制：${apiType} 达到每分钟限制，等待 ${waitTime}ms`,
        ctx,
      );
      await this.sleep(waitTime);
      count = 0;
      this.resetTime.set(apiType, Date.now());
    }

    // 检查每秒限制
    const timeSinceLastCall = now - lastCall;
    const minInterval = 1000 / limit.perSecond;

    if (timeSinceLastCall < minInterval) {
      const waitTime = minInterval - timeSinceLastCall;
      logger.debug(
        `频率限制：${apiType} 达到每秒限制，等待 ${waitTime}ms`,
        ctx,
      );
      await this.sleep(waitTime);
    }

    // 更新状态
    this.lastCallTime.set(apiType, Date.now());
    this.callCount.set(apiType, count + 1);
  }

  /**
   * reset method 重置所有计数器.
   */
  public reset(): void {
    this.lastCallTime.clear();
    this.callCount.clear();
    this.resetTime.clear();
  }

  /**
   * resetForType method 重置指定 API 类型的计数器.
   */
  public resetForType(apiType: FeishuApiType): void {
    this.lastCallTime.delete(apiType);
    this.callCount.delete(apiType);
    this.resetTime.delete(apiType);
  }

  /**
   * getStats method 获取当前频率限制统计.
   */
  public getStats(): Record<
    FeishuApiType,
    { count: number; remaining: number; resetIn: number }
  > {
    const now = Date.now();
    const stats: Record<
      FeishuApiType,
      { count: number; remaining: number; resetIn: number }
    > = {} as Record<
      FeishuApiType,
      { count: number; remaining: number; resetIn: number }
    >;

    for (const apiType of Object.keys(RATE_LIMITS) as FeishuApiType[]) {
      const limit = RATE_LIMITS[apiType];
      const count = this.callCount.get(apiType) ?? 0;
      const reset = this.resetTime.get(apiType) ?? now;
      const resetIn = Math.max(0, 60000 - (now - reset));

      stats[apiType] = {
        count,
        remaining: Math.max(0, limit.perMinute - count),
        resetIn,
      };
    }

    return stats;
  }

  /**
   * healthCheck method 健康检查.
   */
  public healthCheck(): boolean {
    return true;
  }

  /**
   * sleep method 延迟执行.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
