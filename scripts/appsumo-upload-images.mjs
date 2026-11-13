import fs from 'node:fs'
import { withAppsumo } from './appsumo-mcp.mjs'

const submissionId = 235368
const report = []

async function uploadFile(ticket, filePath, altText) {
  const form = new FormData()
  form.append('ticket', ticket.ticket)
  const buf = fs.readFileSync(filePath)
  form.append('image', new Blob([buf], { type: 'image/png' }), filePath.split(/[\\/]/).pop())
  if (altText) form.append('alt_text', altText)
  const res = await fetch(ticket.upload_url, { method: 'POST', body: form })
  const text = await res.text()
  console.log('upload status', res.status, text.slice(0, 500))
  if (!res.ok) throw new Error('upload failed ' + res.status)
  try { return JSON.parse(text) } catch { return { text } }
}

await withAppsumo(async ({ tool }) => {
  const logoTicket = await tool('request_image_upload', {
    submission_id: submissionId,
    image_type: 'logo',
  })
  await uploadFile(logoTicket, 'C:/TREA/meatola/electron/icon.png')
  report.push('logo')

  // Try logo_long from wordmark jpg if available
  const wordmark = 'C:/TREA/meatola/public/landing/moss-wordmark.jpg'
  if (fs.existsSync(wordmark)) {
    try {
      const longTicket = await tool('request_image_upload', {
        submission_id: submissionId,
        image_type: 'logo_long',
      })
      await uploadFile(longTicket, wordmark)
      report.push('logo_long')
    } catch (e) {
      report.push({ logo_long_error: String(e.message || e) })
    }
  }

  const uploads = [
    { image_type: 'main_image', source_url: 'https://annotated.click/landing/shot-hero.png', alt_text: 'Local meetings dashboard' },
    { image_type: 'image', order: 0, source_url: 'https://annotated.click/landing/shot-live.png', alt_text: 'Live call coaching view' },
    { image_type: 'image', order: 1, source_url: 'https://annotated.click/landing/shot-notes.png', alt_text: 'Meeting notes summary' },
    { image_type: 'image', order: 2, source_url: 'https://annotated.click/landing/shot-live-call.png', alt_text: 'On device live transcript' },
  ]

  for (const u of uploads) {
    const r = await tool('upload_image', { submission_id: submissionId, ...u })
    fs.writeFileSync(`C:/TREA/meatola/.appsumo-upload-${u.image_type}-${u.order ?? 'main'}.json`, JSON.stringify(r, null, 2))
    report.push({ slot: u.image_type, order: u.order ?? null, error: r.error || null, id: r.id || r.image_id || null, keys: Object.keys(r) })
  }

  const sub = await tool('get_submission', { submission_id: submissionId })
  fs.writeFileSync('C:/TREA/meatola/.appsumo-submission-235368.parsed.json', JSON.stringify(sub, null, 2))
  report.push({
    logo: sub.logo,
    logo_long: sub.logo_long,
    main_image: sub.main_image,
    additional_images: sub.additional_images,
  })
})

console.log(JSON.stringify(report, null, 2))
