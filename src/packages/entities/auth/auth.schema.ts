import { z } from 'zod';
import { ERROR_MESSAGES } from 'src/data/constants';

export const AUTH_MESSAGES = {
  EMAIL_REQUIRED: ERROR_MESSAGES.AUTH_EMAIL_REQUIRED,
  EMAIL_INVALID: ERROR_MESSAGES.AUTH_EMAIL_INVALID,
  USERNAME_REQUIRED: ERROR_MESSAGES.AUTH_USERNAME_REQUIRED,
  PASSWORD_REQUIRED: ERROR_MESSAGES.AUTH_PASSWORD_REQUIRED,
  PASSWORD_MIN: ERROR_MESSAGES.AUTH_PASSWORD_MIN,
  PASSWORD_MAX: ERROR_MESSAGES.AUTH_PASSWORD_MAX,
  PASSWORD_LOWERCASE: ERROR_MESSAGES.AUTH_PASSWORD_LOWERCASE,
  PASSWORD_UPPERCASE: ERROR_MESSAGES.AUTH_PASSWORD_UPPERCASE,
  PASSWORD_DIGIT: ERROR_MESSAGES.AUTH_PASSWORD_DIGIT,
  PASSWORD_SPECIAL: ERROR_MESSAGES.AUTH_PASSWORD_SPECIAL,
  FIRST_NAME_REQUIRED: ERROR_MESSAGES.AUTH_FIRST_NAME_REQUIRED,
  FIRST_NAME_MAX: ERROR_MESSAGES.AUTH_FIRST_NAME_MAX,
  LAST_NAME_REQUIRED: ERROR_MESSAGES.AUTH_LAST_NAME_REQUIRED,
  LAST_NAME_MAX: ERROR_MESSAGES.AUTH_LAST_NAME_MAX,
  REFRESH_TOKEN_REQUIRED: ERROR_MESSAGES.AUTH_REFRESH_TOKEN_REQUIRED,
  RESET_TOKEN_REQUIRED: ERROR_MESSAGES.AUTH_RESET_TOKEN_REQUIRED,
  RESET_TOKEN_INVALID: ERROR_MESSAGES.AUTH_RESET_TOKEN_INVALID,
  CONFIRM_PASSWORD_REQUIRED: ERROR_MESSAGES.AUTH_CONFIRM_PASSWORD_REQUIRED,
  CONFIRM_PASSWORD_MIN: ERROR_MESSAGES.AUTH_CONFIRM_PASSWORD_MIN,
  CONFIRM_PASSWORD_MAX: ERROR_MESSAGES.AUTH_CONFIRM_PASSWORD_MAX,
  CONFIRM_PASSWORD_MISMATCH: ERROR_MESSAGES.AUTH_CONFIRM_PASSWORD_MISMATCH,
} as const;

export const emailFieldSchema = z
  .string({ message: AUTH_MESSAGES.EMAIL_REQUIRED })
  .min(1, { message: AUTH_MESSAGES.EMAIL_REQUIRED })
  .email({ message: AUTH_MESSAGES.EMAIL_INVALID });

export const passwordFieldSchema = z
  .string({ message: AUTH_MESSAGES.PASSWORD_REQUIRED })
  .min(6, { message: AUTH_MESSAGES.PASSWORD_MIN })
  .max(25, { message: AUTH_MESSAGES.PASSWORD_MAX })
  .superRefine((password, ctx) => {
    if (!/[a-z]/.test(password)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_MESSAGES.PASSWORD_LOWERCASE });
    }
    if (!/[A-Z]/.test(password)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_MESSAGES.PASSWORD_UPPERCASE });
    }
    if (!/\d/.test(password)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_MESSAGES.PASSWORD_DIGIT });
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_MESSAGES.PASSWORD_SPECIAL });
    }
  });

export const registerSchema = z.object({
  email: emailFieldSchema,
  username: z.string({ message: AUTH_MESSAGES.USERNAME_REQUIRED }).optional(),
  password: passwordFieldSchema,
  firstName: z
    .string({ message: AUTH_MESSAGES.FIRST_NAME_REQUIRED })
    .min(1, { message: AUTH_MESSAGES.FIRST_NAME_REQUIRED })
    .max(25, { message: AUTH_MESSAGES.FIRST_NAME_MAX }),
  lastName: z
    .string({ message: AUTH_MESSAGES.LAST_NAME_REQUIRED })
    .min(1, { message: AUTH_MESSAGES.LAST_NAME_REQUIRED })
    .max(25, { message: AUTH_MESSAGES.LAST_NAME_MAX }),
});

export const loginSchema = z.object({
  email: emailFieldSchema,
  password: passwordFieldSchema,
});

export const loginByUserCodeSchema = z.object({
  userCode: z
    .string({ message: ERROR_MESSAGES.AUTH_USER_CODE_REQUIRED })
    .min(6, { message: ERROR_MESSAGES.AUTH_USER_CODE_LENGTH })
    .max(6, { message: ERROR_MESSAGES.AUTH_USER_CODE_LENGTH }),
  password: passwordFieldSchema,
  role: z.enum(['PARENT', 'STUDENT']),
});

export const refreshTokenBodySchema = z.object({
  refreshToken: z
    .string({ message: AUTH_MESSAGES.REFRESH_TOKEN_REQUIRED })
    .min(1, { message: AUTH_MESSAGES.REFRESH_TOKEN_REQUIRED }),
});

export const forgotPasswordSchema = z.object({
  email: emailFieldSchema,
});

const resetPasswordBodySchema = z
  .object({
    jti: z
      .string({ message: AUTH_MESSAGES.RESET_TOKEN_REQUIRED })
      .uuid({ message: AUTH_MESSAGES.RESET_TOKEN_INVALID }),
    password: passwordFieldSchema,
    confirmPassword: z
      .string({ message: AUTH_MESSAGES.CONFIRM_PASSWORD_REQUIRED })
      .min(6, { message: AUTH_MESSAGES.CONFIRM_PASSWORD_MIN })
      .max(25, { message: AUTH_MESSAGES.CONFIRM_PASSWORD_MAX }),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: AUTH_MESSAGES.CONFIRM_PASSWORD_MISMATCH,
        path: ['confirmPassword'],
      });
    }
  });

/** Accept either `password` or `newPassword` (same meaning). */
export const resetPasswordSchema = z.preprocess((val) => {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const o = val as Record<string, unknown>;
    if (o.newPassword != null && o.password == null) {
      return { ...o, password: o.newPassword };
    }
  }
  return val;
}, resetPasswordBodySchema);
