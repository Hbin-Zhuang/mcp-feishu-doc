/**
 * @fileoverview 飞书服务 DI 容器注册.
 * 注册飞书相关的服务提供者到 tsyringe 容器.
 * @module src/container/registrations/feishu
 */

import { container, Lifecycle } from 'tsyringe';

import {
  FeishuApiProviderToken,
  FeishuMarkdownProcessorToken,
  FeishuRateLimiterToken,
  FeishuServiceToken,
} from '@/container/tokens.js';
import {
  FeishuApiProvider,
  FeishuRateLimiter,
  FeishuService,
  MarkdownProcessorProvider,
} from '@/services/feishu/index.js';
import { logger } from '@/utils/index.js';

/**
 * registerFeishuServices function 注册飞书服务到 DI 容器.
 */
export const registerFeishuServices = (): void => {
  // 注册 FeishuApiProvider
  container.register(
    FeishuApiProviderToken,
    { useClass: FeishuApiProvider },
    { lifecycle: Lifecycle.Singleton },
  );

  // 注册 MarkdownProcessorProvider
  container.register(
    FeishuMarkdownProcessorToken,
    { useClass: MarkdownProcessorProvider },
    { lifecycle: Lifecycle.Singleton },
  );

  // 注册 FeishuRateLimiter
  container.register(
    FeishuRateLimiterToken,
    { useClass: FeishuRateLimiter },
    { lifecycle: Lifecycle.Singleton },
  );

  // 注册 FeishuService（编排器）
  // 使用工厂模式注入所有依赖
  container.register(FeishuServiceToken, {
    useFactory: (c) => {
      const feishuService = c.resolve(FeishuService);
      const apiProvider = c.resolve<FeishuApiProvider>(FeishuApiProviderToken);
      const markdownProcessor = c.resolve<MarkdownProcessorProvider>(
        FeishuMarkdownProcessorToken,
      );
      const rateLimiter = c.resolve<FeishuRateLimiter>(FeishuRateLimiterToken);

      // 设置服务提供者
      feishuService.setProviders(apiProvider, markdownProcessor, rateLimiter);

      return feishuService;
    },
  });

  logger.info('飞书服务已注册到 DI 容器');
};
