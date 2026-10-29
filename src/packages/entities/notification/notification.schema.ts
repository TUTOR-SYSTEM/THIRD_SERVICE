import { z } from 'zod';

/** Control characters, whitespace and backslashes: browsers strip tab/newline, so `/\t/x` becomes `//x`. */
// eslint-disable-next-line no-control-regex -- deliberately matches control characters
const UNSAFE_URL_CHARS = /[\u0000-\u0020\u007f\\]/;

/** Hosts allowed for absolute redirects, from `NOTIFICATION_REDIRECT_HOSTS` (comma separated). */
function allowedRedirectHosts(): string[] {
  return (process.env.NOTIFICATION_REDIRECT_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/**
 * Internal path (`/x`) or an `https://` URL whose host is in `NOTIFICATION_REDIRECT_HOSTS`.
 * Anything with whitespace/control chars or a backslash is rejected outright, so `/\t/evil.com`
 * and `/\n/evil.com` cannot turn into protocol-relative URLs in the browser.
 */
export function isSafeRedirectUrl(value: string): boolean {
  if (UNSAFE_URL_CHARS.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  if (!value.startsWith('https://')) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return allowedRedirectHosts().includes(url.hostname.toLowerCase());
}

export const notificationTypeEnum = z.enum(['SYSTEM', 'TUITION', 'STUDENT', 'TUTOR']);
export const notificationActionEnum = z.enum(['VIEW', 'CONTACT', 'PAYMENT', 'UPDATE']);

export const createNotificationSchema = z.object({
  type: notificationTypeEnum,
  title: z
    .string({ message: 'Title is required' })
    .min(1, 'Title is required')
    .max(255, 'Title too long'),
  senderId: z.string().uuid('senderId must be uuid ...').optional().nullable(),
  content: z.string({ message: 'Content must be string ...' }),
  subContent: z.string({ message: 'subContent must be string ...' }).max(255).optional(),
  userId: z.string().uuid('userId must be uuid ...').optional().nullable(),
  classId: z.string().uuid('classId must be uuid ...').optional().nullable(),
  studentId: z.string().uuid('studentId must be uuid ...').optional().nullable(),
  redirectUrl: z
    .string()
    .max(500)
    .refine(isSafeRedirectUrl, 'redirectUrl must be an internal path or an https URL')
    .optional(),
  actionLabel: z.string().max(100).optional(),
  actionType: notificationActionEnum.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const getNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  // An empty / blank search means "no search" (the UI often sends `search=`), not a 400.
  search: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  type: notificationTypeEnum.optional(),
  // Accepts the raw query string ('true'/'false') and an already-parsed boolean (gateway -> RPC).
  isRead: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
});
