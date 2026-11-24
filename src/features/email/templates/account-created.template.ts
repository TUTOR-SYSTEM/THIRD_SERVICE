const BRAND_NAME = 'Gia Sư Pro';
const BRAND_COLOR = '#0e9f8e';
const BRAND_COLOR_DARK = '#0b7a6d';
const TEXT_COLOR = '#16302b';
const MUTED_COLOR = '#5c726d';
const BORDER_COLOR = '#e7eeec';
const SURFACE_COLOR = '#f1fbf9';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const credentialRow = (label: string, value: string) =>
  `<tr><td style="padding:8px 0;font-size:13px;color:${MUTED_COLOR};width:120px;">${label}</td>` +
  `<td style="padding:8px 0;font-size:15px;font-weight:600;color:${TEXT_COLOR};font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;word-break:break-all;">${value}</td></tr>`;

export function renderAccountCreatedEmail(params: {
  displayName: string;
  email: string;
  username: string;
  password: string;
  loginUrl: string;
}) {
  const name = escapeHtml(params.displayName || 'bạn');
  const email = escapeHtml(params.email);
  const username = escapeHtml(params.username);
  const password = escapeHtml(params.password);
  const loginUrl = escapeHtml(params.loginUrl);

  const html = `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Tài khoản ${BRAND_NAME} của bạn</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f8f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f7;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(22,48,43,0.08);">
            <tr>
              <td style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_COLOR_DARK} 100%);background-color:${BRAND_COLOR};padding:28px 32px;text-align:center;">
                <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#c9f1ea;font-weight:600;">${BRAND_NAME}</div>
                <div style="margin-top:6px;font-size:22px;font-weight:700;color:#ffffff;">Tài khoản của bạn đã sẵn sàng</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0 0 12px 0;font-size:16px;color:${TEXT_COLOR};">Xin chào <strong>${name}</strong>,</p>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:${MUTED_COLOR};">
                  Quản trị viên đã tạo tài khoản cho bạn trên ${BRAND_NAME}. Dưới đây là thông tin đăng nhập tạm thời:
                </p>
                <div style="background:${SURFACE_COLOR};border:1px solid ${BORDER_COLOR};border-radius:12px;padding:8px 16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${credentialRow('Email', email)}
                    ${credentialRow('Tên đăng nhập', username)}
                    ${credentialRow('Mật khẩu tạm', password)}
                  </table>
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 32px 8px 32px;">
                <a href="${loginUrl}" style="display:inline-block;padding:12px 28px;border-radius:12px;background:${BRAND_COLOR};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Đăng nhập</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.6;color:#92400e;">
                  <strong>Lưu ý bảo mật:</strong> Bạn sẽ phải đổi mật khẩu ngay ở lần đăng nhập đầu tiên.
                  Không chia sẻ mật khẩu này với bất kỳ ai, kể cả nhân viên ${BRAND_NAME}.
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
    `Quản trị viên đã tạo tài khoản cho bạn trên ${BRAND_NAME}.`,
    `Email: ${params.email}`,
    `Tên đăng nhập: ${params.username}`,
    `Mật khẩu tạm: ${params.password}`,
    '',
    `Đăng nhập tại: ${params.loginUrl}`,
    'Bạn sẽ phải đổi mật khẩu ngay ở lần đăng nhập đầu tiên. Không chia sẻ mật khẩu với bất kỳ ai.',
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { html, text };
}
