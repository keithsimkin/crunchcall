import fs from 'node:fs'
import { withAppsumo } from './appsumo-mcp.mjs'

const fields = JSON.parse(fs.readFileSync('C:/TREA/meatola/.appsumo-update-fields.json'))
const result = await withAppsumo(({ tool }) => tool('update_submission', { submission_id: 235368, fields }))
fs.writeFileSync('C:/TREA/meatola/.appsumo-update-result.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2).slice(0, 5000))

