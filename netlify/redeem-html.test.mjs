import { expect, test } from 'bun:test'
import { proxyRedeem, redeemUpstream, restoreRedeemHtml } from './edge-functions/redeem-html.js'

test('a supabase text/plain rewrite is restored to html and the sandbox policy is dropped', async () => {
  const rewritten = new Response('<!doctype html><title>Redeem</title>', {
    status: 200,
    headers: {
      'content-type': 'text/plain',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-annotated-content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  })
  const fixed = restoreRedeemHtml(rewritten)
  expect(fixed.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(fixed.headers.get('content-security-policy')).toBeNull()
  expect(fixed.headers.get('x-content-type-options')).toBe('nosniff')
  expect(await fixed.text()).toContain('<!doctype html>')
})

test('an html response that supabase did not rewrite is left alone', () => {
  const original = new Response('<!doctype html>', {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-annotated-content-type': 'text/html; charset=utf-8',
    },
  })
  expect(restoreRedeemHtml(original)).toBe(original)
})

test('a missing /redeem file is fetched from the supabase function', async () => {
  expect(redeemUpstream('https://annotated.click/redeem')).toBe(
    'https://nnanwekmhkxcwxrbhtld.supabase.co/functions/v1/redeem',
  )
  const response = await proxyRedeem(new Request('https://annotated.click/redeem'), async (url) => {
    expect(url).toBe('https://nnanwekmhkxcwxrbhtld.supabase.co/functions/v1/redeem')
    return new Response('<!doctype html>', {
      status: 200,
      headers: { 'content-type': 'text/plain', 'x-annotated-content-type': 'text/html; charset=utf-8' },
    })
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
})

test('json license responses are not relabeled as html', () => {
  const json = new Response('{"ok":true}', { headers: { 'content-type': 'application/json; charset=utf-8' } })
  expect(restoreRedeemHtml(json)).toBe(json)
})
