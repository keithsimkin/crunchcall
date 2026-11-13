import { bytesToBase64Url } from './sign.mjs'

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function nonce() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f0f0ec; color: #1c1c1c; font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 32rem; margin: 0 auto; padding: 48px 20px 64px; }
.mark { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
.mark i { width: 28px; height: 28px; border-radius: 8px; background: #2f6b4a; display: grid; place-items: center; color: #f7f7f3; font-style: normal; font-weight: 650; }
.mark span { font-weight: 650; letter-spacing: -0.03em; }
h1 { margin: 0 0 8px; font-size: 1.7rem; font-weight: 640; letter-spacing: -0.04em; }
.lede { margin: 0 0 22px; color: #5f5f5a; }
form, .card { background: #fff; border: 1px solid #e4e4df; border-radius: 16px; padding: 18px; }
label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
label:first-child { margin-top: 0; }
input, textarea { width: 100%; font: inherit; color: inherit; background: #f7f7f3; border: 1px solid #e4e4df; border-radius: 10px; padding: 10px 12px; }
textarea { min-height: 7.5rem; resize: vertical; font: 12px/1.45 ui-monospace, Consolas, monospace; }
button, .link { font: inherit; font-weight: 650; border: 0; border-radius: 999px; padding: 10px 16px; background: #1c1c1c; color: #f7f7f3; text-decoration: none; display: inline-block; }
.row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.ghost { background: #fff; color: #1c1c1c; border: 1px solid #d8d8d1; }
.alert { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: rgba(196, 60, 45, 0.08); color: #c43c2d; }
ol { margin: 16px 0 0; padding-left: 1.2rem; color: #3a3a35; }
li + li { margin-top: 6px; }
.fine { margin: 16px 0 0; color: #5f5f5a; font-size: 14px; }
`

function shell(title, body, scriptNonce) {
  const scriptSrc = scriptNonce ? `; script-src 'nonce-${scriptNonce}'` : ''
  return {
    html: `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
<body>
<main>
<div class="mark"><i>a</i><span>annotated</span></div>
${body}
</main>
</body>
</html>`,
    csp: `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'${scriptSrc}`,
  }
}

function formFields(code, email) {
  return `<label for="code">AppSumo code</label>
<input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" required value="${escapeHtml(code || '')}">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email" required value="${escapeHtml(email || '')}">
<div class="row"><button type="submit">Redeem</button></div>`
}

export function renderForm({ code = '', email = '', error = '' } = {}) {
  const alert = error ? `<p class="alert">${escapeHtml(error)}</p>` : ''
  const page = shell(
    'Redeem annotated',
    `${alert}<h1>Redeem your code</h1>
<p class="lede">One code unlocks annotated on one Windows PC. Stack a code for each computer.</p>
<form method="post" action="/redeem">
${formFields(code, email)}
</form>
<p class="fine">Use the email you want on the license. The same code and email will show this key again.</p>`,
  )
  return page
}

export function renderSuccess(license) {
  const scriptNonce = nonce()
  const page = shell(
    'Your annotated license',
    `<h1>Your license is ready</h1>
<p class="lede">Paste this key into annotated on the Windows PC you want to unlock.</p>
<div class="card">
<label for="key">License key</label>
<textarea id="key" readonly>${escapeHtml(license)}</textarea>
<div class="row">
<button type="button" class="ghost" id="copy">Copy key</button>
<a class="link" href="https://annotated.click">Download annotated</a>
</div>
</div>
<ol>
<li>Download the Windows app from <a href="https://annotated.click">annotated.click</a> and install it.</li>
<li>Open annotated, go to Settings, then License.</li>
<li>Paste the key and choose Activate.</li>
</ol>
<p class="fine">This code stays on that PC. To move it, choose Deactivate this PC in Settings, then License, and activate the same key on the next PC. A second PC needs its own code.</p>
<script nonce="${scriptNonce}">
document.getElementById('copy').addEventListener('click', async () => {
  const field = document.getElementById('key')
  const button = document.getElementById('copy')
  try {
    await navigator.clipboard.writeText(field.value)
    button.textContent = 'Copied'
  } catch {
    field.focus()
    field.select()
    button.textContent = 'Select the key and copy it'
  }
})
</script>`,
    scriptNonce,
  )
  return page
}

export function securityHeaders(csp) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': csp,
  }
}
