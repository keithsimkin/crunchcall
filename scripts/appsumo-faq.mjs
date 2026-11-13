import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TOKENS = path.join(os.homedir(), '.mcp-auth', 'mcp-remote-v1', '44b961529146c9a6dd0768dbf977c4ea_tokens.json')
const token = JSON.parse(fs.readFileSync(TOKENS, 'utf8')).access_token
let sessionId = null
let id = 1

async function mcp(method, params, withId = true) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const body = withId ? { jsonrpc: '2.0', id: id++, method, params } : { jsonrpc: '2.0', method, params }
  const res = await fetch('https://appsumo.com/mcp/', {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  if (!withId) return null
  const text = await res.text()
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/event-stream')) {
    const datas = []
    for (const line of text.split(/\r?\n/)) if (line.startsWith('data:')) datas.push(line.slice(5).trim())
    return JSON.parse(datas.filter(Boolean).join('\n'))
  }
  return JSON.parse(text)
}
async function tool(name, args={}) {
  const r = await mcp('tools/call', { name, arguments: args })
  if (r.error) return r
  const t = r.result?.content?.[0]?.text
  try { return JSON.parse(t) } catch { return r.result }
}

await mcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'meatola-agent', version: '1.0.0' } })
await mcp('notifications/initialized', {}, false)

const site = 'https://annotated.click/'
const faqs = [
  {
    order: 0,
    question: 'Does a bot join my Zoom, Meet, or Teams call?',
    answer: 'No, Annotated never joins as a meeting participant. It runs as a local Windows app beside the call you are already taking.',
    source_url: site,
  },
  {
    order: 1,
    question: 'How does it capture notes if nothing joins the meeting?',
    answer: 'It listens on your PC to the audio mix you already hear and speak. That is why other people never see a notetaker guest in the participant list.',
    source_url: site,
  },
  {
    order: 2,
    question: 'Where does my audio go?',
    answer: 'Transcription and the first summary run on your PC by default, so the recording does not have to leave this machine. If you later attach a Claude or OpenAI key, only text is sent, never the audio stream.',
    source_url: site,
  },
  {
    order: 3,
    question: 'Can other people see the live coaching cues on a screen share?',
    answer: 'No, cues are drawn for you in the annotated window and are meant to stay off a shared screen. Share your meeting window or browser instead of the annotated overlay if you want to keep them private.',
    source_url: site,
  },
  {
    order: 4,
    question: 'Is this really lifetime access?',
    answer: 'Yes, you pay once on AppSumo and keep the features in your purchased tier forever, including updates to those features. Anything we later add as a separate paid add-on would be optional and called out clearly.',
    source_url: site,
  },
  {
    order: 5,
    question: 'What do I get with each AppSumo code?',
    answer: 'Each code unlocks annotated on one Windows PC, including on-device transcription, local summaries, live coaching cues, Markdown export, and searchable history on that machine. Stack more codes if you need more PCs.',
    source_url: site,
  },
  {
    order: 6,
    question: 'Can I use the same code on more than one computer?',
    answer: 'No, one code is tied to one Windows PC unlock. Buy or stack additional codes when you need annotated on another machine.',
    source_url: site,
  },
  {
    order: 7,
    question: 'How do I redeem extra codes after the first one?',
    answer: 'Redeem the first code on your main PC, then redeem each extra code the same way on the next Windows PC. The stacking steps are also listed on the deal page under redemption.',
    source_url: site,
  },
  {
    order: 8,
    question: 'Do I need an annotated account to use it?',
    answer: 'No cloud account is required to capture and keep notes locally on that PC. Redemption and license checks use the code you bought so the unlock stays valid on that machine.',
    source_url: site,
  },
  {
    order: 9,
    question: 'Which meeting apps work?',
    answer: 'Annotated is built for the calls you already take in Zoom, Google Meet, and Microsoft Teams on Windows. If your meeting audio plays through this PC, annotated can listen without joining as a guest.',
    source_url: site,
  },
  {
    order: 10,
    question: 'Does it work offline?',
    answer: 'Local capture and on-device transcription are designed to run on this PC without sending audio to a cloud notetaker. Features that need your own Claude or OpenAI key still need a network path for that text model.',
    source_url: site,
  },
  {
    order: 11,
    question: 'Can I bring my own Claude or OpenAI key?',
    answer: 'Yes, optional keys are for a bigger model on the text side after local capture. Audio still stays on the device, and keys are stored in Windows Credential Manager.',
    source_url: site,
  },
  {
    order: 12,
    question: 'What happens if I never add an AI key?',
    answer: 'You still get on-device transcription, local summaries, next steps, coaching cues, Markdown export, and searchable history. The key is only for people who want a larger cloud model to rewrite or expand the text.',
    source_url: site,
  },
  {
    order: 13,
    question: 'Can I export my notes and take them elsewhere?',
    answer: 'Yes, notes export to Markdown so you can paste them into docs, tickets, or your own archive. Meeting history also stays searchable on that PC.',
    source_url: site,
  },
  {
    order: 14,
    question: 'Where are my notes stored, and what are the limits?',
    answer: 'Notes and transcripts live on the unlocked Windows PC, not in a shared annotated cloud notebook. Storage is bounded by that machine disk space rather than a per-seat cloud quota.',
    source_url: site,
  },
  {
    order: 15,
    question: 'What if I replace my computer?',
    answer: 'Export anything you need as Markdown before you wipe the old machine, then redeem or move your license following the redemption flow for the new PC. Contact hello@annotated.click if a hardware move needs a hand.',
    source_url: site,
  },
  {
    order: 16,
    question: 'How is this different from Otter, Fireflies, Fathom, or Granola?',
    answer: 'Those tools usually depend on a cloud account and often join with a bot or send audio off your machine. Annotated stays local on Windows, keeps the bot out of the participant list, and can coach you mid-call without putting cues on a screen share.',
    source_url: site,
  },
  {
    order: 17,
    question: 'Is Mac or Linux supported?',
    answer: 'Annotated is Windows-first today. Mac and Linux are not part of this deal tier, so buy only if you run your calls on Windows.',
    source_url: site,
  },
  {
    order: 18,
    question: 'Is the installer signed, and how is the license checked?',
    answer: 'Yes, the Windows installer is signed, and the desktop app checks the license on that PC. That keeps the unlock tied to the machine you redeemed rather than a shared password.',
    source_url: site,
  },
  {
    order: 19,
    question: 'What is included forever versus what might cost extra later?',
    answer: 'Everything in your AppSumo tier, including updates to those features, stays covered by the lifetime deal. Brand-new capabilities we invent later as separate products or add-ons would be optional purchases, not a silent pullback of what you already bought.',
    source_url: site,
  },
  {
    order: 20,
    question: 'How fast do you answer support?',
    answer: 'Email hello@annotated.click and we aim to reply within one business day on weekdays. For purchase or refund questions, start from your AppSumo account so the order is attached.',
    source_url: site,
  },
  {
    order: 21,
    question: 'What is the refund window?',
    answer: 'AppSumo deals include a 60-day money-back window. Request it through your AppSumo account if annotated is not the right fit.',
    source_url: site,
  },
  {
    order: 22,
    question: 'Do my teammates need their own codes?',
    answer: 'Yes if they each need annotated unlocked on their own Windows PC. Codes stack by machine, not by a shared cloud workspace seat.',
    source_url: site,
  },
  {
    order: 23,
    question: 'Will future updates break my lifetime deal?',
    answer: 'Updates that improve the features in your tier stay included. We will not turn a core unlocked feature into a new paywall for AppSumo buyers who already purchased that tier.',
    source_url: site,
  },
]

const result = await tool('update_submission', { submission_id: 235368, fields: { faqs } })
if (result.error) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(1)
}
const saved = result.submission?.faqs || []
console.log(JSON.stringify({ count: saved.length, titles: saved.map(f => f.question) }, null, 2))
