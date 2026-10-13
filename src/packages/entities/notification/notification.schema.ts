import { z } from 'zod';

/** Internal path (`/x`, not `//x` or `/\\x`) or an absolute `https://` URL — nothing else. */
function isSafeRedirectUrl(value: string): boolean {
  if (value.startsWith('/')) return !value.startsWith('//') && !value.startsWith('/\\');
  return value.startsWith('https://');
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
  search: z.string().trim().min(1).optional(),
  type: notificationTypeEnum.optional(),
<<<<<<< Updated upstream
  // z.coerce.boolean() would turn the string "false" into true, so parse it explicitly.
=======
  // Accepts the raw query string ('true'/'false') and an already-parsed boolean (gateway -> RPC).
>>>>>>> Stashed changes
  isRead: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
});
