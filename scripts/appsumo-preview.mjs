import fs from 'node:fs'
import { withAppsumo } from './appsumo-mcp.mjs'

await withAppsumo(async ({ tool }) => {
  const preview = await tool('preview_listing', { submission_id: 235368 })
  fs.writeFileSync('C:/TREA/meatola/.appsumo-preview.json', JSON.stringify(preview, null, 2))
  console.log(JSON.stringify({
    preview_url: preview.preview_url,
    keys: Object.keys(preview),
    page_keys: preview.page ? Object.keys(preview.page) : null,
    warnings: preview.warnings || null,
  }, null, 2))
  // Try submit checklist without submitting by calling submit and seeing if it returns checklist? Don't submit.
  // Instead inspect fulfillment and missing founder fields.
  const fulfill = await tool('get_fulfillment', { submission_id: 235368 })
  console.log('fulfillment', JSON.stringify(fulfill, null, 2))
  const sub = await tool('get_submission', { submission_id: 235368 })
  console.log(JSON.stringify({
    support_email: sub.support_email || sub.submission?.support_email || sub.submission?.contacts,
    contacts: sub.submission?.contacts,
    founders_data: sub.submission?.founders_data,
    plans: (sub.submission?.plans || []).map(p => ({ name: p.public_name, price: p.price, original: p.original_price, codes: p.codes })),
    has_codes: sub.has_codes,
    story_value: sub.submission?.story?.value_prop,
    story_subheader: sub.submission?.story?.subheader,
    highlights: sub.submission?.story?.highlights,
    feature_titles: (sub.submission?.story?.features?.items || []).map(i => i.title),
    main_image_alt: sub.main_image?.alt_text,
    gallery_alts: (sub.additional_images || []).map(i => i.alt_text),
  }, null, 2))
})
