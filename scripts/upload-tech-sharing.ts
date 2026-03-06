#!/usr/bin/env node
/**
 * @fileoverview 上传 TECH_SHARING_FEISHU_MCP.md 到飞书私人知识库.
 * 用法: pnpm exec tsx scripts/upload-tech-sharing.ts
 * 前置: 需已完成 OAuth 授权，且 .env 配置正确.
 * @module scripts/upload-tech-sharing
 */

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeContainer } from '../src/container/index.js';
import { container } from 'tsyringe';
import { FeishuServiceToken } from '../src/container/tokens.js';
import type { FeishuService } from '../src/services/feishu/core/FeishuService.js';
import { requestContextService } from '../src/utils/index.js';

const APP_ID = 'cli_a9fe7d82b9f89bc6';
const FILE_PATH = resolve(process.cwd(), 'docs/TECH_SHARING_FEISHU_MCP.md');
const TITLE = '用 MCP 打通飞书文档：feishu-doc-mcp 的开发与实践';

async function main(): Promise<void> {
  composeContainer();
  const feishuService = container.resolve(FeishuServiceToken) as FeishuService;
  const ctx = requestContextService.createRequestContext({
    operation: 'script.uploadTechSharing',
    tenantId: 'feishu-service',
  });

  console.log('📋 正在列出知识库...');
  const wikis = await feishuService.listWikis(ctx, APP_ID);
  if (wikis.length === 0) {
    throw new Error('未找到知识库，请确认已完成 OAuth 授权且应用已添加到知识库');
  }

  const personalWiki = wikis.find(
    (w) =>
      w.name.includes('私人') ||
      w.name.toLowerCase().includes('personal') ||
      w.name.includes('我的'),
  );
  const targetWiki = personalWiki ?? wikis[0];
  console.log(`📁 目标知识库: ${targetWiki.name} (spaceId: ${targetWiki.spaceId})`);

  console.log('📤 正在上传文档...');
  const content = readFileSync(FILE_PATH, 'utf-8');
  const result = await feishuService.uploadMarkdown(
    {
      title: TITLE,
      content,
      filePath: FILE_PATH,
    },
    {
      appId: APP_ID,
      targetType: 'wiki',
      targetId: targetWiki.spaceId,
      uploadImages: false,
      uploadAttachments: false,
      removeFrontMatter: true,
    },
  );

  if (!result.success) {
    throw new Error(`上传失败: ${result.error}`);
  }

  console.log('✅ 上传成功');
  console.log(`   documentId: ${result.documentId}`);
  console.log(`   url: ${result.url}`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
