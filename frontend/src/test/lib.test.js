import { describe, expect, it } from 'vitest';
import { cursorOf } from '../api/endpoints';
import { errorMessage, errorCode } from '../lib/errors';
import { timeAgo } from '../lib/format';

describe('timeAgo', () => {
  it('hiển thị "Vừa xong" cho mốc thời gian gần', () => {
    expect(timeAgo(new Date().toISOString())).toBe('Vừa xong');
  });
  it('hiển thị số phút', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5 * 60000).toISOString(), now)).toContain('5');
  });
});

describe('errorMessage', () => {
  it('lấy message từ phản hồi chuẩn của API', () => {
    const err = {
      response: { data: { success: false, message: 'Email đã được sử dụng', code: 'EMAIL_EXISTS' } },
    };
    expect(errorMessage(err)).toBe('Email đã được sử dụng');
    expect(errorCode(err)).toBe('EMAIL_EXISTS');
  });
  it('ưu tiên lỗi theo trường khi dữ liệu không hợp lệ', () => {
    const err = {
      response: { data: { message: 'Dữ liệu không hợp lệ', errors: { email: ['Email không hợp lệ'] } } },
    };
    expect(errorMessage(err)).toBe('Email không hợp lệ');
  });
  it('báo mất kết nối', () => {
    expect(errorMessage({ message: 'Network Error' })).toBe('Không kết nối được máy chủ.');
  });
});

describe('cursorOf', () => {
  it('tách cursor từ link next', () => {
    expect(cursorOf('http://api.test/api/v1/posts/feed/?cursor=abc%3D')).toBe('abc=');
    expect(cursorOf(null)).toBeUndefined();
  });
});

describe('mutualLabel', () => {
  it('hiển thị số bạn chung, ẩn khi bằng 0', async () => {
    const { mutualLabel } = await import('../lib/format');
    expect(mutualLabel(3)).toBe('3 bạn chung');
    expect(mutualLabel(0)).toBe('');
  });
});
