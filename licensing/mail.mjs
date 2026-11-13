export async function sendLicenseEmail({ to, license, env, fetchImpl }) {
  const from = env && typeof env.ANNOTATED_MAIL_FROM === 'string' ? env.ANNOTATED_MAIL_FROM.trim() : ''
  const key = env && typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : ''
  if (!from || !key) return { ok: false, reason: 'unconfigured' }
  const text = [
    'Your annotated license is ready.',
    '',
    license,
    '',
    'Paste it into annotated under Settings, then License.',
    'Download the Windows app and copy the key again at https://annotated.click/account',
  ].join('\n')
  const response = await (fetchImpl || fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your annotated license',
      text,
    }),
  })
  if (!response.ok) return { ok: false, reason: 'mail' }
  return { ok: true }
}
