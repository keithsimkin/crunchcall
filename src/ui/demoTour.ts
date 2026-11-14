function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function chapter(title: string) {
  window.crunchcall?.tourChapter?.(title)
}

function cursor(): HTMLElement | null {
  return document.getElementById('demo-cursor')
}

async function moveTo(target: HTMLElement, dx = 0.62, dy = 0.5) {
  const mark = cursor()
  if (!mark) return
  const rect = target.getBoundingClientRect()
  mark.style.left = `${Math.round(rect.left + rect.width * dx)}px`
  mark.style.top = `${Math.round(rect.top + rect.height * dy)}px`
  await wait(560)
}

async function clickAt(target: HTMLElement) {
  await moveTo(target)
  cursor()?.classList.add('is-down')
  await wait(90)
  target.click()
  await wait(120)
  cursor()?.classList.remove('is-down')
}

function findText(selector: string, text: string): HTMLElement | null {
  for (const node of document.querySelectorAll(selector)) {
    if (node.textContent?.includes(text)) return node as HTMLElement
  }
  return null
}

async function until(read: () => boolean, limit = 6000) {
  const start = Date.now()
  while (!read()) {
    if (Date.now() - start > limit) return false
    await wait(80)
  }
  return true
}

async function smoothScroll(target: HTMLElement, to: number, ms: number) {
  const start = target.scrollTop
  const began = performance.now()
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const t = Math.min(1, (now - began) / ms)
      const eased = 1 - (1 - t) ** 3
      target.scrollTop = start + (to - start) * eased
      if (t < 1) requestAnimationFrame(frame)
      else resolve()
    }
    requestAnimationFrame(frame)
  })
}

export async function runDemoTour() {
  await until(() => document.documentElement.dataset.desk === 'ready' && document.body.innerText.includes('Northwind'))
  const home = findText('.nav-item', 'Home')
  if (home) await moveTo(home, 0.4, 0.5)

  chapter('Your meeting history')
  await wait(700)
  const scroller = document.querySelector('.content-scroller')
  if (scroller instanceof HTMLElement) {
    await smoothScroll(scroller, Math.min(420, scroller.scrollHeight), 2800)
    await wait(500)
    await smoothScroll(scroller, 0, 1400)
  }
  const northwind = findText('.hist', 'Pricing review with Northwind')
  if (northwind) await moveTo(northwind, 0.35, 0.45)
  await wait(600)

  chapter('Notes, owners, and next steps')
  if (northwind) await clickAt(northwind)
  await until(() => document.body.innerText.includes('Next steps'))
  await wait(700)
  const summary = findText('h2', 'Summary')
  if (summary) await moveTo(summary, 0.2, 0.8)
  const notesScroller = document.querySelector('.content-scroller')
  if (notesScroller instanceof HTMLElement && notesScroller.scrollHeight > notesScroller.clientHeight + 40) {
    await smoothScroll(notesScroller, notesScroller.scrollHeight - notesScroller.clientHeight, 3200)
    await wait(500)
  } else {
    const steps = findText('h2', 'Next steps')
    if (steps) await moveTo(steps, 0.25, 1.4)
    await wait(1600)
  }
  const transcript = findText('.tab', 'Transcript')
  if (transcript) {
    await clickAt(transcript)
    await wait(1100)
  }
  const notesTab = findText('.tab', 'Notes')
  if (notesTab) await clickAt(notesTab)
  await wait(700)

  chapter('Live coaching')
  const live = findText('.nav-item', 'Live')
  if (live) await clickAt(live)
  await until(() => document.body.innerText.includes("Let's lock the overlay"))
  await wait(700)
  for (const label of ['Missing date', 'Stacked questions', 'Talk ratio']) {
    window.__annotatedRevealCue?.()
    await until(() => document.body.innerText.includes(label), 2500)
    const cue = findText('.cue-kind', label)
    if (cue) await moveTo(cue, 0.4, 0.7)
    await wait(1100)
  }

  chapter('The meeting overlay')
  if (window.crunchcall?.recordOverlay) await window.crunchcall.recordOverlay()
  else await wait(2000)

  chapter('Ask your notes')
  const askBox = document.querySelector('.float-ask-box')
  if (askBox instanceof HTMLElement) await clickAt(askBox)
  await wait(400)
  const question = 'What did Northwind decide about annual pricing?'
  if (window.__annotatedTypeAsk) await window.__annotatedTypeAsk(question)
  await wait(350)
  if (window.__annotatedSubmitAsk) await window.__annotatedSubmitAsk()
  await wait(1600)

  const stops: { label: string; title: string; hold: number }[] = [
    { label: 'Calendar', title: 'Calendar', hold: 4200 },
    { label: 'Projects', title: 'Projects', hold: 4200 },
    { label: 'Shortcuts', title: 'Shortcuts', hold: 3800 },
    { label: 'Dictate', title: 'Dictate', hold: 4200 },
    { label: 'Connect', title: 'Connect', hold: 4200 },
  ]
  for (const stop of stops) {
    chapter(stop.title)
    const button =
      stop.label === 'Connect' ? document.querySelector('.connect-card') : findText('.nav-item', stop.label)
    if (button instanceof HTMLElement) await clickAt(button)
    await until(() => document.body.innerText.includes(stop.label === 'Connect' ? 'Let Claude' : stop.label))
    if (stop.label === 'Dictate') {
      const history = document.querySelector('.dictate-history, .content-scroller')
      if (history instanceof HTMLElement) await smoothScroll(history, Math.min(280, history.scrollHeight), 1600)
    }
    if (stop.label === 'Projects') {
      const folder = findText('.folder, .desk', 'Northwind') || findText('h2, strong, p', 'Northwind')
      if (folder) await moveTo(folder, 0.4, 0.55)
    }
    await wait(stop.hold)
  }

  chapter('Settings')
  const gear = document.querySelector('.gear-btn')
  if (gear instanceof HTMLElement) await clickAt(gear)
  await until(() => document.body.innerText.includes('Search settings'))
  const license = findText('.pop-item', 'License')
  if (license) await clickAt(license)
  await until(() => document.body.innerText.includes('fieldnote.example'))
  await wait(4200)
}
