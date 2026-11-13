import { withAppsumo } from './appsumo-mcp.mjs'
import fs from 'node:fs'

await withAppsumo(async ({ tool }) => {
  // discover support email field via tools list description if any
  const preview = await tool('preview_listing', { submission_id: 235368 })
  fs.writeFileSync('C:/TREA/meatola/.appsumo-preview.json', JSON.stringify(preview, null, 2))
  const pdp = preview.pdp || {}
  const dump = JSON.stringify(pdp)
  const supportHits = []
  function walk(obj, path='') {
    if (!obj || typeof obj !== 'object') return
    for (const [k,v] of Object.entries(obj)) {
      const p = path ? path+'.'+k : k
      if (/support|email|contact/i.test(k)) supportHits.push({ path: p, value: typeof v === 'string' ? v : (Array.isArray(v) ? v.slice(0,3) : Object.keys(v||{})) })
      if (v && typeof v === 'object') walk(v, p)
    }
  }
  walk(pdp)
  console.log(JSON.stringify({
    preview_url: preview.preview_url,
    supportHits,
    name: pdp.name || pdp.product_name,
    plans: pdp.plans || pdp.pricing,
  }, null, 2).slice(0, 4000))
})
