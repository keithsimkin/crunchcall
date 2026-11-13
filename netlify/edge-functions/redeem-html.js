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

export default async (_request, context) => {
  const response = await context.next()
  return restoreRedeemHtml(response)
}
