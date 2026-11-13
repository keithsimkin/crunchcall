import { expect, test } from 'bun:test'
import { sendLicenseEmail } from './mail.mjs'

test('license mail is skipped until a from address and api key are set', async () => {
  const skipped = await sendLicenseEmail({ to: 'buyer@example.com', license: 'annotated1.key', env: {} })
  expect(skipped).toEqual({ ok: false, reason: 'unconfigured' })
})

test('license mail posts to resend without a provider sdk', async () => {
  let seen
  const sent = await sendLicenseEmail({
    to: 'buyer@example.com',
    license: 'annotated1.key',
    env: { ANNOTATED_MAIL_FROM: 'annotated <hello@annotated.click>', RESEND_API_KEY: 're_test' },
    fetchImpl: async (url, init) => {
      seen = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }
      return new Response('{}', { status: 200 })
    },
  })
  expect(sent).toEqual({ ok: true })
  expect(seen.url).toBe('https://api.resend.com/emails')
  expect(seen.auth).toBe('Bearer re_test')
  expect(seen.body.to).toEqual(['buyer@example.com'])
  expect(seen.body.text).toContain('annotated1.key')
  expect(seen.body.text).toContain('https://annotated.click/account')
})
