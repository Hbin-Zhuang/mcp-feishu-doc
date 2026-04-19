/**
 * @fileoverview FileSystemProvider 单元测试.
 * @module tests/unit/storage/fileSystemProvider.test
 */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemProvider } from '@/storage/providers/fileSystem/fileSystemProvider.js';
import type { RequestContext } from '@/utils/index.js';

describe('FileSystemProvider', () => {
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(() => {
    process.chdir(originalCwd);
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports regular tenant IDs even when process cwd is filesystem root', async () => {
    const storagePath = mkdtempSync(
      path.join(os.tmpdir(), 'mcp-feishu-doc-storage-'),
    );
    tempDirs.push(storagePath);

    const provider = new FileSystemProvider(storagePath);
    const context: RequestContext = {
      requestId: 'test-request-id',
      timestamp: new Date().toISOString(),
      operation: 'FileSystemProvider.test',
      tenantId: 'feishu-service',
    };

    process.chdir('/');

    await expect(
      provider.set(
        'feishu-service',
        'feishu/config/default_app',
        'cli_test_app',
        context,
      ),
    ).resolves.toBeUndefined();

    await expect(
      provider.get<string>(
        'feishu-service',
        'feishu/config/default_app',
        context,
      ),
    ).resolves.toBe('cli_test_app');
  });

  it('still rejects tenant IDs that use parent directory traversal', async () => {
    const storagePath = mkdtempSync(
      path.join(os.tmpdir(), 'mcp-feishu-doc-storage-'),
    );
    tempDirs.push(storagePath);

    const provider = new FileSystemProvider(storagePath);
    const context: RequestContext = {
      requestId: 'test-request-id',
      timestamp: new Date().toISOString(),
      operation: 'FileSystemProvider.test',
      tenantId: '../escape',
    };

    process.chdir('/');

    await expect(
      provider.set('../escape', 'feishu/config/default_app', 'cli_test_app', context),
    ).rejects.toThrow('Relative path traversal detected');
  });
});
