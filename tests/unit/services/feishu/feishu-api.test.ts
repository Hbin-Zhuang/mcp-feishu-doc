/**
 * @fileoverview 飞书 API 提供者单元测试.
 * 测试 FeishuApiProvider 的各种 API 调用方法.
 * @module tests/unit/services/feishu/feishu-api.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeishuApiProvider } from '@/services/feishu/providers/feishu-api.provider.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('飞书 API 提供者', () => {
  let provider: FeishuApiProvider;

  beforeEach(() => {
    provider = new FeishuApiProvider();
    mockFetch.mockClear();
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
      expect(result.authUrl).toContain('drive%3Adrive');
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
      );

      expect(result).toBe('file_token_123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/drive/v1/medias/upload_all'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test_access_token',
            'Content-Type': expect.stringContaining('multipart/form-data'),
          }),
        }),
      );
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
});
