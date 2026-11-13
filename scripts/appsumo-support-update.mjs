import fs from 'node:fs'
import { withAppsumo } from './appsumo-mcp.mjs'

const fields = {
  contacts: [
    {
      name: 'Keith Simkin',
      title: 'Founder',
      email: 'hello@annotated.click',
    },
  ],
  // common support email locations
  support_email: 'hello@annotated.click',
  company: {
    name: 'annotated',
    description: 'Local meeting notes that never put a bot on your call.',
    company_website: 'https://annotated.click',
    founder_posts: [
      {
        title: 'Why I built annotated',
        message: 'I got tired of notetaker bots showing up in every call. Clients noticed them. Some calls felt less candid the moment a guest labeled "AI notetaker" joined.\n\nSo I built annotated to stay on my PC instead. It listens locally, keeps the transcript on this machine, and gives me cues that stay off a screen share. When the call ends, I want owners and next steps without uploading the recording somewhere else.\n\nThis AppSumo deal is the lifetime way to unlock that on your Windows PCs.',
      },
    ],
  },
}

const result = await withAppsumo(({ tool }) => tool('update_submission', { submission_id: 235368, fields }))
fs.writeFileSync('C:/TREA/meatola/.appsumo-support-update.json', JSON.stringify({
  contacts: result.submission?.contacts,
  support_email: result.support_email,
  founder_posts: result.submission?.company?.founder_posts,
  founders_data: result.submission?.founders_data,
}, null, 2))
console.log(fs.readFileSync('C:/TREA/meatola/.appsumo-support-update.json','utf8'))
