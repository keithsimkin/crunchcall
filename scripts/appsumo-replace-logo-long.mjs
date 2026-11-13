import { withAppsumo } from './appsumo-mcp.mjs'
import fs from 'node:fs'

async function uploadFile(ticket, filePath) {
  const form = new FormData()
  form.append('ticket', ticket.ticket)
  const buf = fs.readFileSync(filePath)
  form.append('image', new Blob([buf], { type: 'image/png' }), 'annotated-logo-long.png')
  const res = await fetch(ticket.upload_url, { method: 'POST', body: form })
  const text = await res.text()
  console.log('status', res.status, text.slice(0, 400))
  if (!res.ok) throw new Error('upload failed')
}

await withAppsumo(async ({ tool }) => {
  const ticket = await tool('request_image_upload', { submission_id: 235368, image_type: 'logo_long' })
  await uploadFile(ticket, 'C:/TREA/meatola/public/landing/annotated-logo-long.png')
  const sub = await tool('get_submission', { submission_id: 235368 })
  console.log(JSON.stringify({ logo_long: sub.logo_long }, null, 2))
})
