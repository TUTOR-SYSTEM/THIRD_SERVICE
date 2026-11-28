const BRAND_NAME = 'Gia Sư Pro';
const BRAND_COLOR = '#0e9f8e';
const TEXT_COLOR = '#16302b';
const MUTED_COLOR = '#5c726d';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Notice to the owner of an address that someone tried to register with. Sent instead of a
 * "registration failed" answer (F-09): the sign-up response itself never reveals the account.
 * Nothing in it changes the account; the owner can simply ignore it.
 */
export function renderAccountExistsEmail(params: {
  displayName: string;
  email: string;
  loginUrl: string;
}) {
  const name = escapeHtml(params.displayName || 'bạn');
  const email = escapeHtml(params.email);
  const loginUrl = escapeHtml(params.loginUrl);

  const html = `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Email đã có tài khoản ${BRAND_NAME}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f8f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f7;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="background:${BRAND_COLOR};padding:28px 32px;text-align:center;">
                <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#c9f1ea;font-weight:600;">${BRAND_NAME}</div>
                <div style="margin-top:6px;font-size:22px;font-weight:700;color:#ffffff;">Email này đã có tài khoản</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 12px 0;font-size:16px;color:${TEXT_COLOR};">Xin chào <strong>${name}</strong>,</p>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:${MUTED_COLOR};">
                  Có người vừa thử đăng ký tài khoản ${BRAND_NAME} bằng địa chỉ <strong>${email}</strong>.
                  Địa chỉ này đã có tài khoản nên chưa có gì thay đổi.
                </p>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:${MUTED_COLOR};">
                  Nếu đó là bạn, hãy đăng nhập bằng tài khoản hiện có. Nếu bạn quên mật khẩu, dùng chức năng quên mật khẩu.
                </p>
                <div align="center">
                  <a href="${loginUrl}" style="display:inline-block;padding:12px 28px;border-radius:12px;background:${BRAND_COLOR};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Đăng nhập</a>
                </div>
                <p style="margin:24px 0 0 0;font-size:13px;line-height:1.6;color:${MUTED_COLOR};">
                  Nếu bạn không thực hiện việc này, có thể bỏ qua email này.
                </p>
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
    `Có người vừa thử đăng ký tài khoản ${BRAND_NAME} bằng địa chỉ ${params.email}.`,
    'Địa chỉ này đã có tài khoản nên chưa có gì thay đổi.',
    `Nếu đó là bạn, đăng nhập tại: ${params.loginUrl}`,
    'Nếu không phải bạn, có thể bỏ qua email này.',
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { html, text };
}
