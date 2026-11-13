// Supabase rewrites GET text/html to text/plain on *.supabase.co and adds a
// sandbox content-security-policy. The function keeps the real type in
// x-annotated-content-type. This runs after the proxy rewrite and puts it back
// so https://annotated.click/redeem renders.

export function restoreRedeemHtml(response) {
  const marked = response.headers.get('x-annotated-content-type') || ''
  if (!marked.toLowerCase().startsWith('text/html')) return response
  const type = (response.headers.get('content-type') || '').toLowerCase()
  const csp = response.headers.get('content-security-policy') || ''
  if (type.startsWith('text/html') && !csp.includes('sandbox')) return response
  const headers = new Headers(response.headers)
  headers.set('content-type', marked)
  if (csp.includes('sandbox')) headers.delete('content-security-policy')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function redeemUpstream(requestUrl) {
  const incoming = new URL(requestUrl)
  const extra = incoming.pathname === '/redeem' ? '' : incoming.pathname.replace(/^\/redeem/, '')
  return `https://nnanwekmhkxcwxrbhtld.supabase.co/functions/v1/redeem${extra}${incoming.search}`
}

export async function proxyRedeem(request, fetchImpl = fetch) {
  const headers = new Headers(request.headers)
  headers.delete('host')
  const response = await fetchImpl(redeemUpstream(request.url), {
    method: request.method,
    headers,
    redirect: 'manual',
  })
  return restoreRedeemHtml(response)
}

export default async (request, context) => {
  const response = await context.next()
  const restored = restoreRedeemHtml(response)
  if (restored.status !== 404 || request.method !== 'GET') return restored
  return proxyRedeem(request)
}
