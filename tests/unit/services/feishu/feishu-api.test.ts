/**
 * @fileoverview 飞书 API 提供者单元测试.
 * 测试 FeishuApiProvider 的各种 API 调用方法.
 * @module tests/unit/services/feishu/feishu-api.test
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeishuApiProvider } from '@/services/feishu/providers/feishu-api.provider.js';
import { DOC_MEDIA_READ_LIMITS } from '@/services/feishu/constants.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('飞书 API 提供者', () => {
  let provider: FeishuApiProvider;

  beforeEach(() => {
    provider = new FeishuApiProvider();
    mockFetch.mockReset();
  });

  describe('generateAuthUrl', () => {
    it('应该生成正确的授权 URL', () => {
      const result = provider.generateAuthUrl(
        'cli_test123',
        'http://localhost:3000/callback',
      );

      expect(result.authUrl).toContain(
        'https://open.feishu.cn/open-apis/authen/v1/authorize',
      );
      expect(result.authUrl).toContain('client_id=cli_test123');
      expect(result.authUrl).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback',
      );
      expect(result.state).toBeDefined();
      expect(result.state.length).toBeGreaterThan(10);
    });

    it('应该包含正确的权限范围', () => {
      const result = provider.generateAuthUrl(
        'cli_test123',
        'http://localhost:3000/callback',
      );

      expect(result.authUrl).toContain('scope=');
      expect(result.authUrl).toContain('contact%3Auser.base%3Areadonly');
      expect(result.authUrl).toContain('docx%3Adocument');
      expect(result.authUrl).toContain('wiki%3Awiki');
      expect(result.authUrl).toContain('offline_access');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('应该成功交换授权码获取令牌', async () => {
      const mockResponse = {
        code: 0,
        access_token: 'test_access_token',
        refresh_token: 'test_refresh_token',
        expires_in: 7200,
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await provider.exchangeCodeForToken(
        'test_code',
        'cli_test123',
        'test_secret',
        'http://localhost:3000/callback',
      );

      expect(result.appId).toBe('cli_test123');
      expect(result.accessToken).toBe('test_access_token');
      expect(result.refreshToken).toBe('test_refresh_token');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('应该处理 OAuth 错误', async () => {
      const mockResponse = {
        code: 1,
        msg: 'invalid_grant',
        error_description: '授权码无效',
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await expect(
        provider.exchangeCodeForToken(
          'invalid_code',
          'cli_test123',
          'test_secret',
          'http://localhost:3000/callback',
        ),
      ).rejects.toThrow('OAuth 错误: 授权码无效');
    });

    it('应该处理嵌套的 data 结构', async () => {
      const mockResponse = {
        code: 0,
        data: {
          access_token: 'nested_access_token',
          refresh_token: 'nested_refresh_token',
          expires_in: 3600,
        },
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await provider.exchangeCodeForToken(
        'test_code',
        'cli_test123',
        'test_secret',
        'http://localhost:3000/callback',
      );

      expect(result.accessToken).toBe('nested_access_token');
      expect(result.refreshToken).toBe('nested_refresh_token');
    });
  });

  describe('refreshToken', () => {
    it('应该成功刷新令牌', async () => {
      const mockResponse = {
        code: 0,
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 7200,
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await provider.refreshToken(
        'old_refresh_token',
        'cli_test123',
        'test_secret',
      );

      expect(result.accessToken).toBe('new_access_token');
      expect(result.refreshToken).toBe('new_refresh_token');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('应该处理刷新失败', async () => {
      const mockResponse = {
        code: 99991665,
        msg: 'refresh_token expired',
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await expect(
        provider.refreshToken(
          'expired_refresh_token',
          'cli_test123',
          'test_secret',
        ),
      ).rejects.toThrow('Token 刷新失败');
    });

    it('应该防止并发刷新', async () => {
      const mockResponse = {
        code: 0,
        access_token: 'concurrent_access_token',
        refresh_token: 'concurrent_refresh_token',
        expires_in: 7200,
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      // 同时发起两个刷新请求
      const promise1 = provider.refreshToken(
        'refresh_token',
        'cli_test123',
        'test_secret',
      );
      const promise2 = provider.refreshToken(
        'refresh_token',
        'cli_test123',
        'test_secret',
      );

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // 应该返回相同的结果
      expect(result1.accessToken).toBe(result2.accessToken);
      expect(mockFetch).toHaveBeenCalledTimes(1); // 只调用一次 API
    });
  });

  describe('getUserInfo', () => {
    it('应该成功获取用户信息', async () => {
      const mockResponse = {
        code: 0,
        data: {
          user_id: 'user123',
          name: '测试用户',
          email: 'test@example.com',
          avatar_url: 'https://example.com/avatar.png',
        },
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await provider.getUserInfo('test_access_token');

      expect(result.userId).toBe('user123');
      expect(result.name).toBe('测试用户');
      expect(result.email).toBe('test@example.com');
      expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('应该处理获取用户信息失败', async () => {
      const mockResponse = {
        code: 99991663,
        msg: 'access_token invalid',
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await expect(provider.getUserInfo('invalid_token')).rejects.toThrow(
        '获取用户信息失败',
      );
    });
  });

  describe('uploadFileBuffer', () => {
    it('应该成功上传文件', async () => {
      const mockResponse = {
        code: 0,
        data: {
          file_token: 'file_token_123',
        },
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const buffer = Buffer.from('test file content');
      const result = await provider.uploadFileBuffer(
        'test_access_token',
        buffer,
        'test.txt',
        'file',
        'doc_123',
      );

      expect(result).toBe('file_token_123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/drive/v1/medias/upload_all'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test_access_token',
          }),
        }),
      );
      const requestOptions = mockFetch.mock.calls[0]?.[1];
      expect(requestOptions?.body).toBeInstanceOf(FormData);
      const body = requestOptions?.body as FormData;
      expect(body.get('parent_node')).toBe('doc_123');
      expect(body.get('parent_type')).toBe('docx_file');
      expect(body.get('file_name')).toBe('test.txt');
      expect(body.get('size')).toBe(String(buffer.byteLength));
      expect(body.get('file')).toBeInstanceOf(Blob);
    });

    it('应该处理上传失败', async () => {
      const mockResponse = {
        code: 1061005,
        msg: '文件大小超出限制',
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const buffer = Buffer.from('large file content');
      await expect(
        provider.uploadFileBuffer(
          'test_access_token',
          buffer,
          'large.txt',
          'file',
          'doc_123',
        ),
      ).rejects.toThrow('文件大小超出限制');
    });
  });

  describe('listFolders', () => {
    it('应该成功列出文件夹', async () => {
      const mockResponse = {
        code: 0,
        data: {
          files: [
            {
              token: 'folder_token_1',
              name: '文件夹1',
              type: 'folder',
              parent_token: 'root',
              created_time: '2024-01-01T00:00:00Z',
              modified_time: '2024-01-01T00:00:00Z',
            },
            {
              token: 'doc_token_1',
              name: '文档1',
              type: 'docx',
              parent_token: 'root',
              created_time: '2024-01-01T00:00:00Z',
              modified_time: '2024-01-01T00:00:00Z',
            },
          ],
          has_more: false,
        },
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await provider.listFolders('test_access_token');

      expect(result).toHaveLength(1); // 只返回文件夹
      expect(result[0]!.token).toBe('folder_token_1');
      expect(result[0]!.name).toBe('文件夹1');
      expect(result[0]!.parentToken).toBe('root');
    });

    it('应该支持指定父文件夹', async () => {
      const mockResponse = {
        code: 0,
        data: {
          files: [],
          has_more: false,
        },
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await provider.listFolders('test_access_token', 'parent_folder_token');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('folder_token=parent_folder_token'),
        expect.any(Object),
      );
    });
  });

  describe('listWikis', () => {
    it('应该成功列出知识库', async () => {
      const mockResponse = {
        code: 0,
        data: {
          items: [
            {
              space_id: 'wiki_space_1',
              name: '知识库1',
              description: '测试知识库',
              space_type: 'team',
              visibility: 'public',
            },
          ],
          has_more: false,
        },
      };

      mockFetch.mockResolvedValueOnce({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await provider.listWikis('test_access_token');

      expect(result).toHaveLength(1);
      expect(result[0]!.spaceId).toBe('wiki_space_1');
      expect(result[0]!.name).toBe('知识库1');
      expect(result[0]!.description).toBe('测试知识库');
    });
  });

  describe('healthCheck', () => {
    it('应该返回 true 当 API 可达时', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 400, // 参数错误但 API 可达
      });

      const result = await provider.healthCheck();
      expect(result).toBe(true);
    });

    it('应该返回 false 当 API 不可达时', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('isTokenExpiredError', () => {
    it('应该正确识别 token 过期错误', () => {
      expect(provider.isTokenExpiredError(99991664)).toBe(true); // access_token expired
      expect(provider.isTokenExpiredError(99991663)).toBe(true); // access_token invalid
      expect(provider.isTokenExpiredError(99991665)).toBe(true); // refresh_token expired
      expect(provider.isTokenExpiredError(20005)).toBe(true); // token invalid
      expect(provider.isTokenExpiredError(1)).toBe(true); // generic invalid token
    });

    it('应该正确识别非 token 错误', () => {
      expect(provider.isTokenExpiredError(0)).toBe(false); // success
      expect(provider.isTokenExpiredError(1061002)).toBe(false); // parameter error
      expect(provider.isTokenExpiredError(99991429)).toBe(false); // rate limit
    });
  });

  describe('重试机制', () => {
    it('应该在频率限制时重试', async () => {
      // 第一次调用返回频率限制错误
      mockFetch
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({ code: 99991429, msg: 'Too many requests' }),
            ),
        })
        // 第二次调用成功
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({ code: 0, data: { user_id: 'test' } }),
            ),
        });

      const result = await provider.getUserInfo('test_token');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.userId).toBe('test');
    });

    it('应该在网络错误时重试', async () => {
      // 第一次网络错误
      mockFetch
        .mockRejectedValueOnce(new TypeError('Network error'))
        // 第二次成功
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({ code: 0, data: { user_id: 'test' } }),
            ),
        });

      const result = await provider.getUserInfo('test_token');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.userId).toBe('test');
    });
  });

  describe('getDocumentContent', () => {
    it('应该按原文顺序返回文本、图片和附件资产', async () => {
      mockFetch
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  document: {
                    document_id: 'doc_123',
                    revision_id: 42,
                    title: '多模态文档',
                  },
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  items: [
                    {
                      block_id: 'page_1',
                      block_type: 1,
                      parent_id: '',
                      page: {
                        elements: [{ text_run: { content: '多模态文档' } }],
                      },
                    },
                    {
                      block_id: 'text_1',
                      block_type: 2,
                      parent_id: 'page_1',
                      text: {
                        elements: [{ text_run: { content: '开场段落' } }],
                      },
                    },
                    {
                      block_id: 'image_1',
                      block_type: 27,
                      parent_id: 'page_1',
                      image: {
                        token: 'img_token_1',
                      },
                    },
                    {
                      block_id: 'text_2',
                      block_type: 2,
                      parent_id: 'page_1',
                      text: {
                        elements: [{ text_run: { content: '插图后的说明' } }],
                      },
                    },
                    {
                      block_id: 'file_1',
                      block_type: 23,
                      parent_id: 'page_1',
                      file: {
                        token: 'file_token_1',
                      },
                    },
                    {
                      block_id: 'text_3',
                      block_type: 2,
                      parent_id: 'page_1',
                      text: {
                        elements: [{ text_run: { content: '结尾段落' } }],
                      },
                    },
                  ],
                  has_more: false,
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  tmp_download_urls: [
                    {
                      file_token: 'img_token_1',
                      tmp_download_url: 'https://cdn.example.com/image-1',
                    },
                    {
                      file_token: 'file_token_1',
                      tmp_download_url: 'https://cdn.example.com/file-1',
                    },
                  ],
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(Uint8Array.from([137, 80, 78, 71]).buffer),
          headers: new Headers({
            'content-type': 'image/png',
            'content-disposition': 'inline; filename="diagram.png"',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(
              Uint8Array.from(Buffer.from('alpha,beta\n1,2', 'utf8')).buffer,
            ),
          headers: new Headers({
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition':
              "attachment; filename*=UTF-8''data.csv",
          }),
        });

      const result = await provider.getDocumentContent(
        'test_access_token',
        'doc_123',
      );

      expect(result.title).toBe('多模态文档');
      expect(result.revisionId).toBe(42);
      expect(result.blocks.map((block) => block.type)).toEqual([
        'text',
        'image',
        'text',
        'file',
        'text',
      ]);
      expect(result.content).toContain('开场段落');
      expect(result.content).toContain('[图片1：diagram.png]');
      expect(result.content).toContain('插图后的说明');
      expect(result.content).toContain('[附件1：data.csv]');
      expect(result.content).toContain('结尾段落');
      expect(
        result.content.indexOf('[图片1：diagram.png]'),
      ).toBeGreaterThan(result.content.indexOf('开场段落'));
      expect(
        result.content.indexOf('[附件1：data.csv]'),
      ).toBeGreaterThan(result.content.indexOf('插图后的说明'));

      const imageAsset = result.assets.find(
        (asset) => asset.type === 'image' && asset.fileToken === 'img_token_1',
      );
      const fileAsset = result.assets.find(
        (asset) => asset.type === 'file' && asset.fileToken === 'file_token_1',
      );

      expect(imageAsset?.mimeType).toBe('image/png');
      expect(imageAsset?.base64Data).toBeDefined();
      expect(fileAsset?.fileName).toBe('data.csv');
      expect(fileAsset?.previewText).toContain('alpha,beta');

      if (imageAsset?.localPath) {
        expect(existsSync(imageAsset.localPath)).toBe(true);
        rmSync(dirname(imageAsset.localPath), { recursive: true, force: true });
      }
    });

    it('图片超过内联限制时应该降级为本地文件模式', async () => {
      const oversizedImage = new Uint8Array(3_000_000).fill(1);

      mockFetch
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  document: {
                    document_id: 'doc_oversized',
                    revision_id: 8,
                    title: '超大图片文档',
                  },
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  items: [
                    {
                      block_id: 'page_1',
                      block_type: 1,
                      parent_id: '',
                      page: {
                        elements: [{ text_run: { content: '超大图片文档' } }],
                      },
                    },
                    {
                      block_id: 'image_1',
                      block_type: 27,
                      parent_id: 'page_1',
                      image: {
                        token: 'img_token_oversized',
                      },
                    },
                  ],
                  has_more: false,
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  tmp_download_urls: [
                    {
                      file_token: 'img_token_oversized',
                      tmp_download_url: 'https://cdn.example.com/oversized-image',
                    },
                  ],
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(oversizedImage.buffer),
          headers: new Headers({
            'content-type': 'image/png',
            'content-disposition': 'inline; filename="oversized.png"',
          }),
        });

      const result = await provider.getDocumentContent(
        'test_access_token',
        'doc_oversized',
      );

      const imageAsset = result.assets.find(
        (asset) =>
          asset.type === 'image' && asset.fileToken === 'img_token_oversized',
      );

      expect(imageAsset).toMatchObject({
        fileName: 'oversized.png',
        mimeType: 'image/png',
        byteLength: 3_000_000,
        deliveryMode: 'local_file_only',
        status: 'skipped_too_large',
        reason: '图片超过单张内联大小限制',
      });
      expect(imageAsset?.base64Data).toBeUndefined();
      expect(imageAsset?.localPath).toBeDefined();

      if (imageAsset?.localPath) {
        expect(existsSync(imageAsset.localPath)).toBe(true);
        rmSync(dirname(imageAsset.localPath), { recursive: true, force: true });
      }
    });

    it('拉取文档图片资源时应该使用有限并发下载', async () => {
      const imageTokens = Array.from(
        { length: DOC_MEDIA_READ_LIMITS.downloadConcurrency + 2 },
        (_, index) => `img_token_concurrent_${index}`,
      );
      let activeDownloads = 0;
      let maxActiveDownloads = 0;

      mockFetch.mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);

        if (url.includes('/blocks?')) {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    items: [
                      {
                        block_id: 'page_1',
                        block_type: 1,
                        parent_id: '',
                        page: {
                          elements: [{ text_run: { content: '并发图片文档' } }],
                        },
                      },
                      ...imageTokens.map((fileToken, index) => ({
                        block_id: `image_${index}`,
                        block_type: 27,
                        parent_id: 'page_1',
                        image: { token: fileToken },
                      })),
                    ],
                    has_more: false,
                  },
                }),
              ),
          };
        }

        if (url.endsWith('/documents/doc_concurrent')) {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    document: {
                      document_id: 'doc_concurrent',
                      revision_id: 13,
                      title: '并发图片文档',
                    },
                  },
                }),
              ),
          };
        }

        if (url.includes('/batch_get_tmp_download_url')) {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    tmp_download_urls: imageTokens.map((fileToken) => ({
                      file_token: fileToken,
                      tmp_download_url: `https://cdn.example.com/${fileToken}`,
                    })),
                  },
                }),
              ),
          };
        }

        if (url.includes('https://cdn.example.com/')) {
          activeDownloads += 1;
          maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeDownloads -= 1;

          return {
            ok: true,
            arrayBuffer: () =>
              Promise.resolve(new Uint8Array([137, 80, 78, 71]).buffer),
            headers: new Headers({
              'content-type': 'image/png',
              'content-disposition': `inline; filename="${url.split('/').pop()}.png"`,
            }),
          };
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });

      const result = await provider.getDocumentContent(
        'test_access_token',
        'doc_concurrent',
      );

      expect(result.assets).toHaveLength(imageTokens.length);
      expect(maxActiveDownloads).toBeGreaterThan(1);
      expect(maxActiveDownloads).toBeLessThanOrEqual(
        DOC_MEDIA_READ_LIMITS.downloadConcurrency,
      );

      result.assets.forEach((asset) => {
        if (asset.localPath) {
          rmSync(dirname(asset.localPath), { recursive: true, force: true });
        }
      });
    });
  });

  describe('batchGetTmpDownloadUrls', () => {
    it('应该按批次请求临时下载链接', async () => {
      const tokens = Array.from({ length: 21 }, (_, index) => `file_token_${index}`);

      mockFetch
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  tmp_download_urls: tokens.slice(0, 20).map((fileToken) => ({
                    file_token: fileToken,
                    tmp_download_url: `https://cdn.example.com/${fileToken}`,
                  })),
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  tmp_download_urls: [
                    {
                      file_token: tokens[20],
                      tmp_download_url: `https://cdn.example.com/${tokens[20]}`,
                    },
                  ],
                },
              }),
            ),
        });

      const result = await (provider as unknown as {
        batchGetTmpDownloadUrls: (
          accessToken: string,
          fileTokens: string[],
        ) => Promise<Map<string, string>>;
      }).batchGetTmpDownloadUrls('test_access_token', tokens);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(21);
      expect(result.get('file_token_0')).toBe(
        'https://cdn.example.com/file_token_0',
      );
      expect(result.get('file_token_20')).toBe(
        'https://cdn.example.com/file_token_20',
      );
    });
  });

  describe('replaceDocumentPlaceholdersWithMedia', () => {
    it('应该创建空图片块、上传素材到图片块并替换 token', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'feishu-image-'));
      const imagePath = join(tempDir, 'diagram.png');
      writeFileSync(imagePath, Buffer.from([137, 80, 78, 71]));

      mockFetch
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  items: [
                    {
                      block_id: 'page_1',
                      block_type: 1,
                      parent_id: '',
                      children: ['text_1'],
                    },
                    {
                      block_id: 'text_1',
                      block_type: 2,
                      parent_id: 'page_1',
                      text: {
                        elements: [
                          {
                            text_run: {
                              content: '前文 __IMG_PLACEHOLDER__ 后文',
                            },
                          },
                        ],
                      },
                    },
                  ],
                  has_more: false,
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  children: [
                    {
                      block_id: 'image_block_1',
                      block_type: 27,
                      parent_id: 'page_1',
                      image: {
                        token: '',
                        height: 100,
                        width: 100,
                      },
                    },
                    {
                      block_id: 'text_2',
                      block_type: 2,
                      parent_id: 'page_1',
                    },
                  ],
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  file_token: 'img_token_1',
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
        })
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  children: [
                    {
                      block_id: 'text_2',
                      block_type: 2,
                      parent_id: 'page_1',
                    },
                  ],
                },
              }),
            ),
        });

      const result = await provider.replaceDocumentPlaceholdersWithMedia(
        'test_access_token',
        'doc_123',
        [
          {
            placeholder: '__IMG_PLACEHOLDER__',
            originalPath: imagePath,
            type: 'image',
            fileName: 'diagram.png',
          },
        ],
      );

      expect(result).toEqual({
        uploadedFiles: [
          {
            originalPath: imagePath,
            fileName: 'diagram.png',
            fileKey: 'img_token_1',
            isImage: true,
          },
        ],
        mediaUploadFailures: [],
      });
      const createCall = mockFetch.mock.calls[1];
      expect(createCall?.[0]).toContain(
        '/docx/v1/documents/doc_123/blocks/page_1/children',
      );
      const createBody = JSON.parse(createCall?.[1]?.body as string) as {
        children: Array<Record<string, unknown>>;
      };
      expect(createBody.children[0]).toEqual({
        block_type: 27,
        image: {},
      });

      const uploadCall = mockFetch.mock.calls[2];
      expect(uploadCall?.[0]).toContain('/drive/v1/medias/upload_all');
      const uploadBody = uploadCall?.[1]?.body as FormData;
      expect(uploadBody.get('parent_type')).toBe('docx_image');
      expect(uploadBody.get('parent_node')).toBe('image_block_1');
      expect(uploadBody.get('file_name')).toBe('diagram.png');
      expect(uploadBody.get('size')).toBe('4');

      const replaceCall = mockFetch.mock.calls[3];
      expect(replaceCall?.[0]).toContain(
        '/docx/v1/documents/doc_123/blocks/image_block_1',
      );
      expect(JSON.parse(replaceCall?.[1]?.body as string)).toEqual({
        replace_image: {
          token: 'img_token_1',
        },
      });

      const updateTextCall = mockFetch.mock.calls[4];
      expect(updateTextCall?.[0]).toContain(
        '/docx/v1/documents/doc_123/blocks/text_1',
      );
      expect(JSON.parse(updateTextCall?.[1]?.body as string)).toEqual({
        update_text_elements: {
          elements: [
            {
              text_run: {
                content: '前文',
              },
            },
          ],
        },
      });

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('应该兼容导入后丢失首尾下划线的占位符，并按 file block 协议上传附件', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'feishu-file-'));
      const filePath = join(tempDir, 'data.csv');
      writeFileSync(filePath, 'alpha,beta\n1,2', 'utf8');

      mockFetch
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  items: [
                    {
                      block_id: 'page_1',
                      block_type: 1,
                      parent_id: '',
                      children: ['text_1'],
                    },
                    {
                      block_id: 'text_1',
                      block_type: 2,
                      parent_id: 'page_1',
                      text: {
                        elements: [
                          {
                            text_run: {
                              content: '前文 MCP_CONTENT_12345_abcd 后文',
                            },
                          },
                        ],
                      },
                    },
                  ],
                  has_more: false,
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  children: [
                    {
                      block_id: 'view_block_1',
                      block_type: 33,
                      parent_id: 'page_1',
                      children: ['file_block_1'],
                      view: {
                        view_type: 1,
                      },
                    },
                    {
                      block_id: 'text_2',
                      block_type: 2,
                      parent_id: 'page_1',
                    },
                  ],
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  file_token: 'file_token_1',
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
        })
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
        })
        .mockResolvedValueOnce({
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: {
                  children: [
                    {
                      block_id: 'text_2',
                      block_type: 2,
                      parent_id: 'page_1',
                    },
                  ],
                },
              }),
            ),
        });

      const result = await provider.replaceDocumentPlaceholdersWithMedia(
        'test_access_token',
        'doc_123',
        [
          {
            placeholder: '__MCP_CONTENT_12345_abcd__',
            originalPath: filePath,
            type: 'file',
            fileName: 'data.csv',
          },
        ],
      );

      expect(result).toEqual({
        uploadedFiles: [
          {
            originalPath: filePath,
            fileName: 'data.csv',
            fileKey: 'file_token_1',
            isImage: false,
          },
        ],
        mediaUploadFailures: [],
      });

      const createCall = mockFetch.mock.calls[1];
      expect(createCall?.[0]).toContain(
        '/docx/v1/documents/doc_123/blocks/page_1/children',
      );
      const createBody = JSON.parse(createCall?.[1]?.body as string) as {
        children: Array<Record<string, unknown>>;
      };
      expect(createBody.children[0]).toEqual({
        block_type: 23,
        file: {
          token: '',
        },
      });

      const uploadCall = mockFetch.mock.calls[2];
      expect(uploadCall?.[0]).toContain('/drive/v1/medias/upload_all');
      const uploadBody = uploadCall?.[1]?.body as FormData;
      expect(uploadBody.get('parent_type')).toBe('docx_file');
      expect(uploadBody.get('parent_node')).toBe('file_block_1');
      expect(uploadBody.get('file_name')).toBe('data.csv');
      expect(uploadBody.get('size')).toBe(String(Buffer.byteLength('alpha,beta\n1,2')));

      const replaceCall = mockFetch.mock.calls[3];
      expect(replaceCall?.[0]).toContain(
        '/docx/v1/documents/doc_123/blocks/file_block_1',
      );
      expect(JSON.parse(replaceCall?.[1]?.body as string)).toEqual({
        replace_file: {
          token: 'file_token_1',
        },
      });

      const updateTextCall = mockFetch.mock.calls[4];
      expect(updateTextCall?.[0]).toContain(
        '/docx/v1/documents/doc_123/blocks/text_1',
      );
      expect(JSON.parse(updateTextCall?.[1]?.body as string)).toEqual({
        update_text_elements: {
          elements: [
            {
              text_run: {
                content: '前文',
              },
            },
          ],
        },
      });

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('多媒体回填时应该只拉取一次文档 blocks', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'feishu-multi-patch-'));
      const imagePath1 = join(tempDir, 'diagram-1.png');
      const imagePath2 = join(tempDir, 'diagram-2.png');
      writeFileSync(imagePath1, Buffer.from([137, 80, 78, 71, 1]));
      writeFileSync(imagePath2, Buffer.from([137, 80, 78, 71, 2]));

      let createCallCount = 0;
      let uploadCallCount = 0;

      mockFetch.mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);

        if (url.includes('/blocks?')) {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    items: [
                      {
                        block_id: 'page_1',
                        block_type: 1,
                        parent_id: '',
                        children: ['text_1', 'text_2'],
                      },
                      {
                        block_id: 'text_1',
                        block_type: 2,
                        parent_id: 'page_1',
                        text: {
                          elements: [
                            {
                              text_run: {
                                content: '图一 __IMG_PLACEHOLDER_1__ 结束',
                              },
                            },
                          ],
                        },
                      },
                      {
                        block_id: 'text_2',
                        block_type: 2,
                        parent_id: 'page_1',
                        text: {
                          elements: [
                            {
                              text_run: {
                                content: '图二 __IMG_PLACEHOLDER_2__ 完成',
                              },
                            },
                          ],
                        },
                      },
                    ],
                    has_more: false,
                  },
                }),
              ),
          };
        }

        if (url.includes('/blocks/page_1/children')) {
          createCallCount += 1;
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    children: [
                      {
                        block_id: `image_block_${createCallCount}`,
                        block_type: 27,
                        parent_id: 'page_1',
                        image: {
                          token: '',
                          height: 100,
                          width: 100,
                        },
                      },
                    ],
                  },
                }),
              ),
          };
        }

        if (url.includes('/drive/v1/medias/upload_all')) {
          uploadCallCount += 1;
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    file_token: `img_token_${uploadCallCount}`,
                  },
                }),
              ),
          };
        }

        if (url.includes('/blocks/image_block_')) {
          return {
            text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
          };
        }

        if (url.includes('/blocks/text_')) {
          return {
            text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
          };
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });

      const result = await provider.replaceDocumentPlaceholdersWithMedia(
        'test_access_token',
        'doc_123',
        [
          {
            placeholder: '__IMG_PLACEHOLDER_1__',
            originalPath: imagePath1,
            type: 'image',
            fileName: 'diagram-1.png',
          },
          {
            placeholder: '__IMG_PLACEHOLDER_2__',
            originalPath: imagePath2,
            type: 'image',
            fileName: 'diagram-2.png',
          },
        ],
      );

      expect(result.uploadedFiles).toEqual([
        {
          originalPath: imagePath1,
          fileName: 'diagram-1.png',
          fileKey: 'img_token_1',
          isImage: true,
        },
        {
          originalPath: imagePath2,
          fileName: 'diagram-2.png',
          fileKey: 'img_token_2',
          isImage: true,
        },
      ]);
      expect(result.mediaUploadFailures).toEqual([]);

      const blockFetchCalls = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/blocks?'),
      );
      expect(blockFetchCalls).toHaveLength(1);

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('同一文本块内多个占位符应在一次 children 创建中完成回填', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'feishu-grouped-patch-'));
      const imagePath1 = join(tempDir, 'diagram-a.png');
      const imagePath2 = join(tempDir, 'diagram-b.png');
      writeFileSync(imagePath1, Buffer.from([137, 80, 78, 71, 11]));
      writeFileSync(imagePath2, Buffer.from([137, 80, 78, 71, 12]));

      mockFetch.mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);

        if (url.includes('/blocks?')) {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    items: [
                      {
                        block_id: 'page_1',
                        block_type: 1,
                        parent_id: '',
                        children: ['text_1'],
                      },
                      {
                        block_id: 'text_1',
                        block_type: 2,
                        parent_id: 'page_1',
                        text: {
                          elements: [
                            {
                              text_run: {
                                content:
                                  '开头 __IMG_PLACEHOLDER_1__ 中间 __IMG_PLACEHOLDER_2__ 结尾',
                              },
                            },
                          ],
                        },
                      },
                    ],
                    has_more: false,
                  },
                }),
              ),
          };
        }

        if (url.includes('/blocks/page_1/children')) {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    children: [
                      {
                        block_id: 'image_block_1',
                        block_type: 27,
                        parent_id: 'page_1',
                        image: { token: '', height: 100, width: 100 },
                      },
                      {
                        block_id: 'text_middle',
                        block_type: 2,
                        parent_id: 'page_1',
                      },
                      {
                        block_id: 'image_block_2',
                        block_type: 27,
                        parent_id: 'page_1',
                        image: { token: '', height: 100, width: 100 },
                      },
                      {
                        block_id: 'text_tail',
                        block_type: 2,
                        parent_id: 'page_1',
                      },
                    ],
                  },
                }),
              ),
          };
        }

        if (url.includes('/drive/v1/medias/upload_all')) {
          const body = mockFetch.mock.calls.at(-1)?.[1]?.body as FormData;
          const parentNode = body.get('parent_node');
          const token = parentNode === 'image_block_1' ? 'img_token_a' : 'img_token_b';
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: { file_token: token },
                }),
              ),
          };
        }

        if (url.includes('/blocks/image_block_')) {
          return {
            text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
          };
        }

        if (url.includes('/blocks/text_1')) {
          return {
            text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
          };
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });

      const result = await provider.replaceDocumentPlaceholdersWithMedia(
        'test_access_token',
        'doc_123',
        [
          {
            placeholder: '__IMG_PLACEHOLDER_1__',
            originalPath: imagePath1,
            type: 'image',
            fileName: 'diagram-a.png',
          },
          {
            placeholder: '__IMG_PLACEHOLDER_2__',
            originalPath: imagePath2,
            type: 'image',
            fileName: 'diagram-b.png',
          },
        ],
      );

      expect(result.uploadedFiles).toEqual([
        {
          originalPath: imagePath1,
          fileName: 'diagram-a.png',
          fileKey: 'img_token_a',
          isImage: true,
        },
        {
          originalPath: imagePath2,
          fileName: 'diagram-b.png',
          fileKey: 'img_token_b',
          isImage: true,
        },
      ]);
      expect(result.mediaUploadFailures).toEqual([]);

      const createCalls = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/blocks/page_1/children'),
      );
      expect(createCalls).toHaveLength(1);
      const createBody = JSON.parse(createCalls[0]?.[1]?.body as string) as {
        children: Array<Record<string, unknown>>;
      };
      expect(createBody.children).toEqual([
        { block_type: 27, image: {} },
        {
          block_type: 2,
          text: {
            elements: [{ text_run: { content: '中间' } }],
          },
        },
        { block_type: 27, image: {} },
        {
          block_type: 2,
          text: {
            elements: [{ text_run: { content: '结尾' } }],
          },
        },
      ]);

      const updateCalls = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/blocks/text_1'),
      );
      expect(updateCalls).toHaveLength(1);
      expect(JSON.parse(updateCalls[0]?.[1]?.body as string)).toEqual({
        update_text_elements: {
          elements: [
            {
              text_run: {
                content: '开头',
              },
            },
          ],
        },
      });

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('分组回填中途失败时应清理本次新建的 children', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'feishu-grouped-cleanup-'));
      const imagePath1 = join(tempDir, 'diagram-cleanup-a.png');
      const imagePath2 = join(tempDir, 'diagram-cleanup-b.png');
      writeFileSync(imagePath1, Buffer.from([137, 80, 78, 71, 21]));
      writeFileSync(imagePath2, Buffer.from([137, 80, 78, 71, 22]));

      mockFetch.mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);

        if (url.includes('/blocks?')) {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    items: [
                      {
                        block_id: 'page_1',
                        block_type: 1,
                        parent_id: '',
                        children: ['text_1'],
                      },
                      {
                        block_id: 'text_1',
                        block_type: 2,
                        parent_id: 'page_1',
                        text: {
                          elements: [
                            {
                              text_run: {
                                content:
                                  '开头 __IMG_PLACEHOLDER_1__ 中间 __IMG_PLACEHOLDER_2__ 结尾',
                              },
                            },
                          ],
                        },
                      },
                    ],
                    has_more: false,
                  },
                }),
              ),
          };
        }

        if (url.includes('/blocks/page_1/children/batch_delete')) {
          return {
            text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
          };
        }

        if (url.includes('/blocks/page_1/children')) {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 0,
                  data: {
                    children: [
                      {
                        block_id: 'image_block_cleanup_1',
                        block_type: 27,
                        parent_id: 'page_1',
                        image: { token: '', height: 100, width: 100 },
                      },
                      {
                        block_id: 'text_cleanup_middle',
                        block_type: 2,
                        parent_id: 'page_1',
                      },
                      {
                        block_id: 'image_block_cleanup_2',
                        block_type: 27,
                        parent_id: 'page_1',
                        image: { token: '', height: 100, width: 100 },
                      },
                      {
                        block_id: 'text_cleanup_tail',
                        block_type: 2,
                        parent_id: 'page_1',
                      },
                    ],
                  },
                }),
              ),
          };
        }

        if (url.includes('/drive/v1/medias/upload_all')) {
          const body = mockFetch.mock.calls.at(-1)?.[1]?.body as FormData;
          const parentNode = body.get('parent_node');
          if (parentNode === 'image_block_cleanup_1') {
            return {
              text: () =>
                Promise.resolve(
                  JSON.stringify({
                    code: 0,
                    data: { file_token: 'img_token_cleanup_a' },
                  }),
                ),
            };
          }

          throw new Error('upload failed for second media');
        }

        if (url.includes('/blocks/image_block_cleanup_1')) {
          return {
            text: () => Promise.resolve(JSON.stringify({ code: 0, data: {} })),
          };
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });

      const result = await provider.replaceDocumentPlaceholdersWithMedia(
        'test_access_token',
        'doc_123',
        [
          {
            placeholder: '__IMG_PLACEHOLDER_1__',
            originalPath: imagePath1,
            type: 'image',
            fileName: 'diagram-cleanup-a.png',
          },
          {
            placeholder: '__IMG_PLACEHOLDER_2__',
            originalPath: imagePath2,
            type: 'image',
            fileName: 'diagram-cleanup-b.png',
          },
        ],
      );

      expect(result.uploadedFiles).toEqual([]);
      expect(result.mediaUploadFailures).toEqual([
        {
          originalPath: imagePath1,
          fileName: 'diagram-cleanup-a.png',
          isImage: true,
          error: '请求失败: Error: upload failed for second media',
          status: 'upload_failed',
        },
        {
          originalPath: imagePath2,
          fileName: 'diagram-cleanup-b.png',
          isImage: true,
          error: '请求失败: Error: upload failed for second media',
          status: 'upload_failed',
        },
      ]);

      const cleanupCalls = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/blocks/page_1/children/batch_delete'),
      );
      expect(cleanupCalls).toHaveLength(1);
      expect(JSON.parse(cleanupCalls[0]?.[1]?.body as string)).toEqual({
        start_index: 1,
        end_index: 5,
      });

      rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
