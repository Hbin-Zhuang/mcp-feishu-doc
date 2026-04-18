/**
 * @fileoverview 飞书服务编排器单元测试.
 * 验证上传 Markdown 后的媒体回填编排行为.
 * @module tests/unit/services/feishu/feishu-service.test
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FeishuService } from '@/services/feishu/core/FeishuService.js';
import type {
  IFeishuApiProvider,
  IMarkdownProcessor,
  IRateLimiter,
} from '@/services/feishu/core/IFeishuProvider.js';
import type {
  LocalFileInfo,
  MarkdownProcessResult,
  StoredFeishuAuth,
} from '@/services/feishu/types.js';

describe('飞书服务编排器', () => {
  const appId = 'cli_test_app';
  const auth: StoredFeishuAuth = {
    appId,
    appSecret: '',
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    expiresAt: Date.now() + 10 * 60_000,
  };

  let service: FeishuService;
  let storage: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  let apiProvider: IFeishuApiProvider & {
    replaceDocumentPlaceholdersWithMedia: ReturnType<typeof vi.fn>;
  };
  let markdownProcessor: IMarkdownProcessor;
  let rateLimiter: IRateLimiter;
  let tempDir: string;
  let localFiles: LocalFileInfo[];
  let markdownProcessResult: MarkdownProcessResult;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'feishu-service-'));
    const imagePath = join(tempDir, 'diagram.png');
    const filePath = join(tempDir, 'data.csv');
    writeFileSync(imagePath, Buffer.from([137, 80, 78, 71]));
    writeFileSync(filePath, 'alpha,beta\n1,2', 'utf8');

    localFiles = [
      {
        originalPath: imagePath,
        fileName: 'diagram.png',
        placeholder: '__IMG_PLACEHOLDER__',
        isImage: true,
        altText: 'diagram',
      },
      {
        originalPath: filePath,
        fileName: 'data.csv',
        placeholder: '__FILE_PLACEHOLDER__',
        isImage: false,
        altText: 'data',
      },
    ];

    markdownProcessResult = {
      content:
        '开场段落\n\n__IMG_PLACEHOLDER__\n\n中间说明\n\n__FILE_PLACEHOLDER__\n\n结尾段落',
      localFiles,
      frontMatter: null,
      extractedTitle: '上传文档',
    };

    storage = {
      get: vi.fn(async (key: string) => {
        if (key === `feishu/auth/${appId}`) {
          return auth;
        }
        return null;
      }),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => ({ keys: [] })),
    };

    apiProvider = {
      name: 'feishu-api',
      generateAuthUrl: vi.fn(),
      exchangeCodeForToken: vi.fn(),
      refreshToken: vi.fn(),
      getUserInfo: vi.fn(),
      createDocument: vi.fn(async () => ({
        documentId: 'doc_123',
        url: 'https://feishu.cn/docx/doc_123',
        title: '上传文档',
      })),
      updateDocument: vi.fn(),
      getDocumentMeta: vi.fn(async () => ({
        documentId: 'doc_123',
        updatedAt: Date.now(),
        revisionId: 42,
      })),
      deleteDocument: vi.fn(),
      getDocumentContent: vi.fn(),
      searchDocuments: vi.fn(),
      uploadFile: vi.fn(),
      uploadFileBuffer: vi.fn(),
      listFolders: vi.fn(),
      listWikis: vi.fn(),
      getWikiNodes: vi.fn(),
      healthCheck: vi.fn(async () => true),
      replaceDocumentPlaceholdersWithMedia: vi.fn(async () => ({
        uploadedFiles: [
          {
            originalPath: localFiles[0]!.originalPath,
            fileName: localFiles[0]!.fileName,
            fileKey: 'img_token_1',
            isImage: true,
          },
          {
            originalPath: localFiles[1]!.originalPath,
            fileName: localFiles[1]!.fileName,
            fileKey: 'file_token_1',
            isImage: false,
          },
        ],
        mediaUploadFailures: [],
      })),
    } as unknown as IFeishuApiProvider & {
      replaceDocumentPlaceholdersWithMedia: ReturnType<typeof vi.fn>;
    };

    markdownProcessor = {
      name: 'markdown-processor',
      process: vi.fn(() => markdownProcessResult),
      healthCheck: vi.fn(async () => true),
    };

    rateLimiter = {
      name: 'rate-limiter',
      throttle: vi.fn(async () => undefined),
      reset: vi.fn(),
      healthCheck: vi.fn(() => true),
    };

    service = new FeishuService(storage as never);
    service.setProviders(apiProvider, markdownProcessor, rateLimiter);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('会在上传本地图片和附件后回填到正文中', async () => {
    const result = await service.uploadMarkdown(
      {
        title: '上传文档',
        content: markdownProcessResult.content,
        workingDirectory: tempDir,
      },
      {
        appId,
        targetType: 'drive',
        uploadImages: true,
        uploadAttachments: true,
      },
    );

    expect(apiProvider.replaceDocumentPlaceholdersWithMedia).toHaveBeenCalledWith(
      'access_token',
      'doc_123',
      [
        {
          originalPath: localFiles[0]!.originalPath,
          resolvedPath: localFiles[0]!.originalPath,
          placeholder: '__IMG_PLACEHOLDER__',
          type: 'image',
          fileName: 'diagram.png',
        },
        {
          originalPath: localFiles[1]!.originalPath,
          resolvedPath: localFiles[1]!.originalPath,
          placeholder: '__FILE_PLACEHOLDER__',
          type: 'file',
          fileName: 'data.csv',
        },
      ],
    );
    expect(apiProvider.uploadFile).not.toHaveBeenCalled();
    expect(result.uploadedFiles).toEqual([
      {
        originalPath: localFiles[0]!.originalPath,
        fileName: 'diagram.png',
        fileKey: 'img_token_1',
        isImage: true,
      },
      {
        originalPath: localFiles[1]!.originalPath,
        fileName: 'data.csv',
        fileKey: 'file_token_1',
        isImage: false,
      },
    ]);
    expect(result.mediaUploadFailures).toBeUndefined();
  });

  it('媒体回填整体失败时仍然返回上传成功并显式带出失败详情', async () => {
    apiProvider.replaceDocumentPlaceholdersWithMedia.mockRejectedValueOnce(
      new Error('patch failed'),
    );

    const result = await service.uploadMarkdown(
      {
        title: '上传文档',
        content: markdownProcessResult.content,
        workingDirectory: tempDir,
      },
      {
        appId,
        targetType: 'drive',
        uploadImages: true,
        uploadAttachments: true,
      },
    );

    expect(result.success).toBe(true);
    expect(result.documentId).toBe('doc_123');
    expect(result.uploadedFiles).toEqual([]);
    expect(result.mediaUploadFailures).toEqual([
      {
        originalPath: localFiles[0]!.originalPath,
        fileName: 'diagram.png',
        isImage: true,
        error: 'patch failed',
        status: 'upload_failed',
      },
      {
        originalPath: localFiles[1]!.originalPath,
        fileName: 'data.csv',
        isImage: false,
        error: 'patch failed',
        status: 'upload_failed',
      },
    ]);
  });

  it('provider 返回部分媒体失败时会在结果中显式返回失败详情', async () => {
    apiProvider.replaceDocumentPlaceholdersWithMedia.mockResolvedValueOnce({
      uploadedFiles: [
        {
          originalPath: localFiles[1]!.originalPath,
          fileName: 'data.csv',
          fileKey: 'file_token_1',
          isImage: false,
        },
      ],
      mediaUploadFailures: [
        {
          originalPath: localFiles[0]!.originalPath,
          fileName: 'diagram.png',
          isImage: true,
          error: 'forbidden.',
          status: 'upload_failed',
        },
      ],
    });

    const result = await service.uploadMarkdown(
      {
        title: '上传文档',
        content: markdownProcessResult.content,
        workingDirectory: tempDir,
      },
      {
        appId,
        targetType: 'drive',
        uploadImages: true,
        uploadAttachments: true,
      },
    );

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toEqual([
      {
        originalPath: localFiles[1]!.originalPath,
        fileName: 'data.csv',
        fileKey: 'file_token_1',
        isImage: false,
      },
    ]);
    expect(result.mediaUploadFailures).toEqual([
      {
        originalPath: localFiles[0]!.originalPath,
        fileName: 'diagram.png',
        isImage: true,
        error: 'forbidden.',
        status: 'upload_failed',
      },
    ]);
    expect(apiProvider.replaceDocumentPlaceholdersWithMedia).toHaveBeenCalledWith(
      'access_token',
      'doc_123',
      [
        {
          originalPath: localFiles[0]!.originalPath,
          resolvedPath: localFiles[0]!.originalPath,
          placeholder: '__IMG_PLACEHOLDER__',
          type: 'image',
          fileName: 'diagram.png',
        },
        {
          originalPath: localFiles[1]!.originalPath,
          resolvedPath: localFiles[1]!.originalPath,
          placeholder: '__FILE_PLACEHOLDER__',
          type: 'file',
          fileName: 'data.csv',
        },
      ],
    );
  });

  it('媒体数量超过限制时会跳过超限文件并保留失败详情', async () => {
    const manyTempDir = mkdtempSync(join(tmpdir(), 'feishu-service-many-'));
    const manyFiles = Array.from({ length: 21 }, (_, index) => {
      const filePath = join(manyTempDir, `image-${index}.png`);
      writeFileSync(filePath, Buffer.from([index]));

      return {
        originalPath: filePath,
        fileName: `image-${index}.png`,
        placeholder: `__IMG_PLACEHOLDER_${index}__`,
        isImage: true,
        altText: `image-${index}`,
      } satisfies LocalFileInfo;
    });

    markdownProcessor.process = vi.fn(() => ({
      content: manyFiles.map((file) => file.placeholder).join('\n\n'),
      localFiles: manyFiles,
      frontMatter: null,
      extractedTitle: '多图片上传文档',
    }));

    apiProvider.replaceDocumentPlaceholdersWithMedia.mockResolvedValueOnce({
      uploadedFiles: manyFiles.slice(0, 20).map((file, index) => ({
        originalPath: file.originalPath,
        fileName: file.fileName,
        fileKey: `img_token_${index}`,
        isImage: true,
      })),
      mediaUploadFailures: [],
    });

    const result = await service.uploadMarkdown(
      {
        title: '多图片上传文档',
        content: manyFiles.map((file) => file.placeholder).join('\n\n'),
        workingDirectory: manyTempDir,
      },
      {
        appId,
        targetType: 'drive',
        uploadImages: true,
        uploadAttachments: true,
      },
    );

    expect(apiProvider.replaceDocumentPlaceholdersWithMedia).toHaveBeenCalledWith(
      'access_token',
      'doc_123',
      manyFiles.slice(0, 20).map((file) => ({
        originalPath: file.originalPath,
        resolvedPath: file.originalPath,
        placeholder: file.placeholder,
        type: 'image' as const,
        fileName: file.fileName,
      })),
    );
    expect(result.uploadedFiles).toHaveLength(20);
    expect(result.mediaUploadFailures).toEqual([
      {
        originalPath: manyFiles[20]!.originalPath,
        fileName: manyFiles[20]!.fileName,
        isImage: true,
        error: '媒体数量超过单篇文档上传上限',
        status: 'skipped_over_limit',
      },
    ]);

    rmSync(manyTempDir, { recursive: true, force: true });
  });

  it('启用 downloadRemoteImages 时会先下载远程图片再回填', async () => {
    const remoteUrl = `https://example.com/assets/remote-diagram-${Date.now()}.png`;
    markdownProcessResult = {
      content: '远程图片：\n\n__REMOTE_IMG__',
      localFiles: [
        {
          originalPath: remoteUrl,
          remoteUrl,
          sourceType: 'remote',
          fileName: 'remote-diagram.png',
          placeholder: '__REMOTE_IMG__',
          isImage: true,
          altText: 'remote-diagram',
        },
      ],
      frontMatter: null,
      extractedTitle: '远程图片上传文档',
    };
    markdownProcessor.process = vi.fn(() => markdownProcessResult);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
          controller.close();
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    apiProvider.replaceDocumentPlaceholdersWithMedia.mockImplementationOnce(
      async (_accessToken, _documentId, patches) => ({
        uploadedFiles: [
          {
            originalPath: patches[0]!.originalPath,
            fileName: patches[0]!.fileName,
            fileKey: 'img_remote_1',
            isImage: true,
          },
        ],
        mediaUploadFailures: [],
      }),
    );

    const result = await service.uploadMarkdown(
      {
        title: '远程图片上传文档',
        content: markdownProcessResult.content,
        workingDirectory: tempDir,
      },
      {
        appId,
        targetType: 'drive',
        uploadImages: true,
        downloadRemoteImages: true,
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      remoteUrl,
    );
    const patchCall = apiProvider.replaceDocumentPlaceholdersWithMedia.mock.calls[0];
    const patches = patchCall?.[2] as Array<{ originalPath: string; resolvedPath?: string }>;
    expect(patches[0]!.originalPath).toBe(
      remoteUrl,
    );
    expect(patches[0]!.resolvedPath).toContain('/mcp-feishu-doc/feishu-upload-remote/');
    expect(existsSync(patches[0]!.resolvedPath!)).toBe(false);
    expect(result.uploadedFiles).toEqual([
      {
        originalPath: remoteUrl,
        fileName: 'remote-diagram.png',
        fileKey: 'img_remote_1',
        isImage: true,
      },
    ]);

    vi.unstubAllGlobals();
  });

  it('启用 downloadRemoteAttachments 时会先下载远程附件再回填，并在完成后清理临时文件', async () => {
    const remoteUrl = `https://example.com/files/remote-report-${Date.now()}.pdf`;
    markdownProcessResult = {
      content: '远程附件：\n\n__REMOTE_FILE__',
      localFiles: [
        {
          originalPath: remoteUrl,
          remoteUrl,
          sourceType: 'remote',
          fileName: 'remote-report.pdf',
          placeholder: '__REMOTE_FILE__',
          isImage: false,
          altText: 'remote-report',
        },
      ],
      frontMatter: null,
      extractedTitle: '远程附件上传文档',
    };
    markdownProcessor.process = vi.fn(() => markdownProcessResult);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
          );
          controller.close();
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    let resolvedPath: string | undefined;
    apiProvider.replaceDocumentPlaceholdersWithMedia.mockImplementationOnce(
      async (_accessToken, _documentId, patches) => {
        resolvedPath = patches[0]!.resolvedPath;
        return {
          uploadedFiles: [
            {
              originalPath: patches[0]!.originalPath,
              fileName: patches[0]!.fileName,
              fileKey: 'file_remote_1',
              isImage: false,
            },
          ],
          mediaUploadFailures: [],
        };
      },
    );

    const result = await service.uploadMarkdown(
      {
        title: '远程附件上传文档',
        content: markdownProcessResult.content,
        workingDirectory: tempDir,
      },
      {
        appId,
        targetType: 'drive',
        uploadAttachments: true,
        downloadRemoteAttachments: true,
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(remoteUrl);
    expect(resolvedPath).toContain('/mcp-feishu-doc/feishu-upload-remote/');
    expect(existsSync(resolvedPath!)).toBe(false);
    expect(result.uploadedFiles).toEqual([
      {
        originalPath: remoteUrl,
        fileName: 'remote-report.pdf',
        fileKey: 'file_remote_1',
        isImage: false,
      },
    ]);

    vi.unstubAllGlobals();
  });

  it('命中已有远程媒体缓存时不会重复下载，也不会误删缓存文件', async () => {
    const remoteUrl = `https://example.com/files/cached-report-${Date.now()}.pdf`;
    const cacheKey = createHash('sha1').update(remoteUrl).digest('hex');
    const tempRoot = join(tmpdir(), 'mcp-feishu-doc', 'feishu-upload-remote');
    mkdirSync(tempRoot, { recursive: true });
    const cachedPath = join(tempRoot, `${cacheKey}-cached-report.pdf`);
    writeFileSync(cachedPath, Buffer.from([0x25, 0x50, 0x44, 0x46]));

    markdownProcessResult = {
      content: '缓存附件：\n\n__REMOTE_FILE__',
      localFiles: [
        {
          originalPath: remoteUrl,
          remoteUrl,
          sourceType: 'remote',
          fileName: 'cached-report.pdf',
          placeholder: '__REMOTE_FILE__',
          isImage: false,
          altText: 'cached-report',
        },
      ],
      frontMatter: null,
      extractedTitle: '缓存附件上传文档',
    };
    markdownProcessor.process = vi.fn(() => markdownProcessResult);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    let resolvedPath: string | undefined;
    apiProvider.replaceDocumentPlaceholdersWithMedia.mockImplementationOnce(
      async (_accessToken, _documentId, patches) => {
        resolvedPath = patches[0]!.resolvedPath;
        return {
          uploadedFiles: [
            {
              originalPath: patches[0]!.originalPath,
              fileName: patches[0]!.fileName,
              fileKey: 'file_remote_cached_1',
              isImage: false,
            },
          ],
          mediaUploadFailures: [],
        };
      },
    );

    await service.uploadMarkdown(
      {
        title: '缓存附件上传文档',
        content: markdownProcessResult.content,
        workingDirectory: tempDir,
      },
      {
        appId,
        targetType: 'drive',
        uploadAttachments: true,
        downloadRemoteAttachments: true,
      },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolvedPath).toBe(cachedPath);
    expect(existsSync(cachedPath)).toBe(true);

    vi.unstubAllGlobals();
    rmSync(cachedPath, { force: true });
  });
});
