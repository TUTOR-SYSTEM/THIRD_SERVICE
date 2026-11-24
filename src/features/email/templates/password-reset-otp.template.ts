/** Minutes a reset code stays valid. Must match `RESET_PASSWORD_OTP_TTL_SECONDS` in `user`. */
export const PASSWORD_RESET_OTP_TTL_MINUTES = 5;

const BRAND_NAME = 'Gia Sư Pro';
const BRAND_COLOR = '#0e9f8e';
const BRAND_COLOR_DARK = '#0b7a6d';
const TEXT_COLOR = '#16302b';
const MUTED_COLOR = '#5c726d';
const BORDER_COLOR = '#e7eeec';
const SURFACE_COLOR = '#f1fbf9';

/**
 * Progressive enhancement: clients that support CSS animation (Apple Mail, iOS Mail, Thunderbird,
 * most webmail apps outside Gmail/Outlook) play it; the rest ignore it and show the static code.
 * Digits fade in one after another, then glow once; the expiry pill pulses gently.
 */
const OTP_ANIMATION_CSS = `
      @keyframes otpDigitIn {
        0% { opacity: 0; box-shadow: 0 0 0 0 rgba(14,159,142,0); }
        60% { opacity: 1; box-shadow: 0 0 0 6px rgba(14,159,142,0.28); }
        100% { opacity: 1; box-shadow: 0 0 0 0 rgba(14,159,142,0); }
      }
      @keyframes otpPillPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
      @media (prefers-reduced-motion: reduce) {
        .otp-digit, .otp-pill { animation: none !important; opacity: 1 !important; }
      }`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** One boxed cell per digit so the code reads clearly on every mail client. */
const renderDigitBoxes = (otp: string) =>
  otp
    .split('')
    .map(
      (digit, index) =>
        `<td class="otp-digit" style="width:48px;height:60px;text-align:center;vertical-align:middle;` +
        `background:#ffffff;border:1px solid ${BORDER_COLOR};border-bottom:3px solid ${BRAND_COLOR};` +
        `border-radius:12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;` +
        `font-size:28px;font-weight:700;color:${TEXT_COLOR};` +
        `animation:otpDigitIn 0.9s ease-out ${(index * 0.12).toFixed(2)}s both;">${digit}</td>`,
    )
    .join('<td style="width:8px;"></td>');

export function renderPasswordResetOtpEmail(params: { otp: string; displayName: string }) {
  const name = escapeHtml(params.displayName || 'bạn');
  const otp = escapeHtml(params.otp);

  const html = `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Mã đặt lại mật khẩu ${BRAND_NAME}</title>
    <style>${OTP_ANIMATION_CSS}
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f4f8f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Mã xác nhận đặt lại mật khẩu của bạn: ${otp}. Có hiệu lực trong ${PASSWORD_RESET_OTP_TTL_MINUTES} phút.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f7;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(22,48,43,0.08);">
            <tr>
              <td style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_COLOR_DARK} 100%);background-color:${BRAND_COLOR};padding:28px 32px;text-align:center;">
                <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#c9f1ea;font-weight:600;">${BRAND_NAME}</div>
                <div style="margin-top:6px;font-size:22px;font-weight:700;color:#ffffff;">Đặt lại mật khẩu</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0 0 12px 0;font-size:16px;color:${TEXT_COLOR};">Xin chào <strong>${name}</strong>,</p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:${MUTED_COLOR};">
                  Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nhập mã xác nhận bên dưới vào trang đặt lại mật khẩu:
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                  <tr>${renderDigitBoxes(otp)}</tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 32px 8px 32px;">
                <div class="otp-pill" style="display:inline-block;padding:8px 16px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:13px;font-weight:600;animation:otpPillPulse 2.4s ease-in-out 1.5s infinite;">
                  ⏱ Mã có hiệu lực trong ${PASSWORD_RESET_OTP_TTL_MINUTES} phút
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <div style="background:${SURFACE_COLOR};border:1px solid ${BORDER_COLOR};border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.6;color:${MUTED_COLOR};">
                  <strong style="color:${TEXT_COLOR};">Không phải bạn?</strong> Bỏ qua email này. Mật khẩu của bạn sẽ không thay đổi.
                  Không chia sẻ mã này với bất kỳ ai, kể cả nhân viên ${BRAND_NAME}.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${BORDER_COLOR};text-align:center;font-size:12px;color:${MUTED_COLOR};">
                © ${new Date().getFullYear()} ${BRAND_NAME}. Email này được gửi tự động, vui lòng không trả lời.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Xin chào ${params.displayName || 'bạn'},`,
    '',
    'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.',
    `Mã xác nhận: ${params.otp}`,
    `Mã có hiệu lực trong ${PASSWORD_RESET_OTP_TTL_MINUTES} phút.`,
    '',
    'Nếu bạn không yêu cầu, hãy bỏ qua email này. Không chia sẻ mã với bất kỳ ai.',
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { html, text };
}
