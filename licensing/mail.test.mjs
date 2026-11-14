import { expect, test } from 'bun:test'
import { sendLicenseEmail, sendMagicLinkEmail } from './mail.mjs'

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
  expect(seen.body.html).toContain('annotated1.key')
})

test('magic link mail posts a sign-in email through resend', async () => {
  let seen
  const sent = await sendMagicLinkEmail({
    to: 'buyer@example.com',
    actionLink: 'https://annotated.click/account#access_token=demo',
    env: { ANNOTATED_MAIL_FROM: 'annotated <hello@annotated.click>', RESEND_API_KEY: 're_test' },
    fetchImpl: async (url, init) => {
      seen = { url, body: JSON.parse(init.body) }
      return new Response('{}', { status: 200 })
    },
  })
  expect(sent).toEqual({ ok: true })
  expect(seen.url).toBe('https://api.resend.com/emails')
  expect(seen.body.subject).toBe('Sign in to annotated')
  expect(seen.body.from).toBe('annotated <hello@annotated.click>')
  expect(seen.body.reply_to).toBe('hello@annotated.click')
  expect(seen.body.text).toContain('https://annotated.click/account#access_token=demo')
  expect(seen.body.text).toContain('spam or junk folder')
  expect(seen.body.html).toContain('annotated')
  expect(seen.body.html).toContain('spam or junk folder')
})
