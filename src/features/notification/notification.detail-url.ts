import { isSafeRedirectUrl } from '../../packages/entities/notification/notification.schema';

/** Trang chi tiết mặc định theo loại thông báo, dùng khi người gửi không truyền `redirectUrl` hợp lệ. */
const FALLBACK_BY_TYPE: Record<string, string> = {
  TUITION: '/fees',
  STUDENT: '/grades',
  TUTOR: '/notifications',
  SYSTEM: '/notifications',
};

/**
 * URL mở trang chi tiết của một thông báo. Ưu tiên `redirectUrl` do người gửi đặt (đường dẫn
 * chi tiết cụ thể của đối tượng, vd bài tập/buổi học); không có thì rơi về trang mặc định theo loại.
 */
export function resolveDetailUrl(note: { type: string; redirectUrl?: string | null }): string {
  const url = note.redirectUrl?.trim();
  if (url && isSafeRedirectUrl(url)) return url;
  return FALLBACK_BY_TYPE[note.type] ?? '/notifications';
}

/** Gắn `detailUrl` vào một thông báo (không đổi các field cũ). */
export function withDetailUrl<T extends { type: string; redirectUrl?: string | null }>(note: T) {
  return { ...note, detailUrl: resolveDetailUrl(note) };
}
