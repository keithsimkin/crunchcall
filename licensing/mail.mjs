async function sendResendEmail({ to, subject, text, html, env, fetchImpl }) {
  const from = env && typeof env.ANNOTATED_MAIL_FROM === 'string' ? env.ANNOTATED_MAIL_FROM.trim() : ''
  const key = env && typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : ''
  if (!from || !key) return { ok: false, reason: 'unconfigured' }
  const body = {
    from,
    to: [to],
    subject,
    text,
    reply_to: 'hello@annotated.click',
  }
  if (html) body.html = html
  const response = await (fetchImpl || fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) return { ok: false, reason: 'mail' }
  return { ok: true }
}

function brandedShell({ title, bodyHtml, footerNote }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef1ea;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1ea;padding:28px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dfe4d8;">
          <tr>
            <td style="padding:22px 24px 12px;background:#171917;color:#f7f4ec;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
              <div style="font-size:20px;font-weight:750;letter-spacing:-0.03em;">annotated</div>
              <div style="margin-top:4px;font-size:13px;color:#bdbdb8;">Local-first meeting notepad</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#171917;line-height:1.55;font-size:15px;">
              <h1 style="margin:0 0 12px;font-size:22px;letter-spacing:-0.03em;">${escapeHtml(title)}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 22px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#5f675c;font-size:12.5px;line-height:1.45;">
              ${footerNote || 'Sent by annotated · annotated.click'}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function sendLicenseEmail({ to, license, env, fetchImpl }) {
  const text = [
    'Your annotated license is ready.',
    '',
    license,
    '',
    'Paste it into annotated under Settings, then License.',
    'Open https://annotated.click/account to copy the key again or download Windows.',
    '',
    '— annotated',
  ].join('\n')
  const html = brandedShell({
    title: 'Your license is ready',
    bodyHtml: `
      <p style="margin:0 0 14px;">Here is your Unlock key for annotated on Windows.</p>
      <p style="margin:0 0 16px;font-family:ui-monospace,Consolas,monospace;font-size:13px;padding:12px 14px;background:#f3f5f0;border-radius:10px;word-break:break-all;">${escapeHtml(license)}</p>
      <p style="margin:0 0 14px;">Paste it into annotated under <strong>Settings → License</strong>.</p>
      <p style="margin:0;"><a href="https://annotated.click/account" style="color:#4f6a3c;font-weight:700;">Open your account</a></p>
    `,
  })
  return sendResendEmail({
    to,
    subject: 'Your annotated license',
    text,
    html,
    env,
    fetchImpl,
  })
}

export async function sendMagicLinkEmail({ to, actionLink, env, fetchImpl }) {
  const text = [
    'Sign in to annotated',
    '',
    'Open this link to continue. It expires soon and can only be used once.',
    '',
    actionLink,
    '',
    'If you do not see this email, check your spam or junk folder.',
    'If you did not ask for this, you can ignore the email.',
    '',
    '— annotated · hello@annotated.click',
  ].join('\n')
  const html = brandedShell({
    title: 'Sign in to annotated',
    bodyHtml: `
      <p style="margin:0 0 16px;">Use the button below to open your account. The link expires soon and works once.</p>
      <p style="margin:0 0 18px;">
        <a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#d7e4c8;color:#171917;font-weight:700;text-decoration:none;">Sign in to annotated</a>
      </p>
      <p style="margin:0 0 8px;color:#5f675c;font-size:13px;">Or paste this link into your browser:</p>
      <p style="margin:0 0 16px;font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all;color:#5f675c;">${escapeHtml(actionLink)}</p>
      <p style="margin:0;color:#5f675c;font-size:13px;">Do not see it? Check your spam or junk folder.</p>
    `,
    footerNote: 'Sent by annotated with Resend · hello@annotated.click · If you did not ask for this, ignore the email.',
  })
  return sendResendEmail({
    to,
    subject: 'Sign in to annotated',
    text,
    html,
    env,
    fetchImpl,
  })
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
