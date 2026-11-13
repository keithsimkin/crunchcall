import fs from 'node:fs'
import { withAppsumo } from './appsumo-mcp.mjs'

await withAppsumo(async ({ tool }) => {
  const ticket = await tool('request_image_upload', { submission_id: 235368, image_type: 'logo' })
  const curl = ticket.curl || ''
  // Redact ticket/secrets from curl for inspection
  const redacted = curl
    .replace(/ticket=[^&\s"']+/gi, 'ticket=REDACTED')
    .replace(/[A-Za-z0-9_-]{20,}/g, (m) => m.length > 40 ? 'REDACTED' : m)
  console.log(JSON.stringify({
    keys: Object.keys(ticket),
    limits: ticket.limits,
    image_type: ticket.image_type,
    has_upload_url: Boolean(ticket.upload_url),
    curl_redacted: redacted,
    curl_len: curl.length,
  }, null, 2))
  fs.writeFileSync('C:/TREA/meatola/.appsumo-logo-curl-redacted.txt', redacted)
})
