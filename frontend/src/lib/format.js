const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'Vừa xong';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function clockTime(iso) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function compactNumber(n) {
  return new Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(n || 0);
}

/** UPDATE_ADDFRIEND_01: "3 bạn chung"; không có bạn chung thì trả chuỗi rỗng. */
export function mutualLabel(count) {
  return count > 0 ? `${count} bạn chung` : '';
}

export const PRIVACY_LABEL = { PUBLIC: 'Công khai', FRIENDS: 'Bạn bè', PRIVATE: 'Chỉ mình tôi' };
export const ROLE_LABEL = { ADMIN: 'Quản trị viên', MOD: 'Kiểm duyệt viên', MEMBER: 'Thành viên' };
