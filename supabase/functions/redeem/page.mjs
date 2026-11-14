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

const KICKER = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.1c.35 1.9 1 3 2.6 3.6C8 5.3 7.35 6.4 7 8.3 6.65 6.4 6 5.3 4.4 4.7 6 4.1 6.65 3 7 1.1Z" fill="currentColor"/><path d="M11.1 7.2c.2 1.05.55 1.6 1.4 1.9-.85.3-1.2.85-1.4 1.9-.2-1.05-.55-1.6-1.4-1.9.85-.3 1.2-.85 1.4-1.9Z" fill="currentColor"/></svg>`

const CSS = `
@font-face { font-family: "Source Sans 3"; font-style: normal; font-weight: 400 800; font-display: swap; src: url("/fonts/source-sans-3-latin.woff2") format("woff2"); }
@font-face { font-family: "Source Serif 4"; font-style: normal; font-weight: 400 600; font-display: swap; src: url("/fonts/source-serif-4-latin.woff2") format("woff2"); }
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f5f5f3; color: #1c1c1c; font: 16px/1.55 "Source Sans 3", "Segoe UI", sans-serif; }
a { color: inherit; }
.navwrap { display: flex; justify-content: center; padding: 14px 12px 8px; }
.nav { position: relative; display: flex; align-items: center; gap: 4px; width: max-content; max-width: calc(100vw - 24px); padding: 6px 6px 6px 16px; border-radius: 999px; background: #171717; color: #fff; box-shadow: 0 12px 32px rgba(20, 24, 18, 0.16); }
.menu-toggle { position: absolute; opacity: 0; pointer-events: none; }
.menu { display: none; margin-left: auto; padding: 8px 12px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.brand { display: inline-flex; align-items: center; gap: 8px; margin-right: 8px; color: #fff; font-size: 14px; font-weight: 650; letter-spacing: -0.03em; text-decoration: none; }
.brand svg { flex: none; }
.nav a.item { padding: 8px 12px; border-radius: 999px; color: #e6e6e2; font-size: 13.5px; text-decoration: none; }
.cta { margin-left: 6px; padding: 8px 14px; border-radius: 999px; background: #fff; color: #1c1c1c; font-size: 13px; font-weight: 600; text-decoration: none; }
main { width: min(760px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 48px; text-align: center; }
.kicker { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 14px; color: #6a6a64; font-size: 12px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; }
h1 { margin: 0; font-family: "Source Serif 4", Georgia, serif; font-weight: 500; font-size: clamp(46px, 6.4vw, 72px); line-height: 1.04; letter-spacing: -0.02em; }
.lede { max-width: 460px; margin: 18px auto 0; color: #5f5f5a; }
.card { width: min(460px, 100%); margin: 36px auto 0; padding: 28px 24px; border-radius: 28px; background: rgba(255,255,255,.94); box-shadow: 0 24px 50px rgba(28, 40, 22, 0.14); text-align: left; }
label { display: block; margin: 14px 0 6px; font-size: 13px; font-weight: 650; }
label:first-child { margin-top: 0; }
input, textarea { width: 100%; border: 1px solid #e4e4df; border-radius: 14px; background: #f7f7f4; color: inherit; padding: 12px 14px; font: inherit; }
textarea { min-height: 7rem; resize: vertical; font: 12.5px/1.45 ui-monospace, Consolas, monospace; }
.row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
button, .link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 999px; border: 1px solid transparent; background: #171717; color: #fff; font: inherit; font-size: 14px; font-weight: 600; text-decoration: none; }
.ghost { background: transparent; border-color: #d9d9d3; color: #1c1c1c; }
.note { margin: 14px 0 0; padding: 10px 12px; border-radius: 14px; background: #f3f3ef; color: #5f5f5a; font-size: 14px; }
ol { margin: 18px 0 0; padding-left: 1.2rem; color: #3a3a35; text-align: left; }
.fern { min-height: 220px; margin-top: 64px; background: #c5d4bc url("/landing/moss-features.jpg") center 62% / cover no-repeat; }
@media (max-width: 720px) {
  .menu { display: inline-flex; }
  h1 { font-size: 42px; }
  .nav nav { display: none; position: absolute; top: calc(100% + 8px); left: 0; right: 0; flex-direction: column; padding: 8px; border-radius: 18px; background: #171717; box-shadow: 0 16px 30px rgba(0, 0, 0, 0.2); }
  .menu-toggle:checked ~ nav { display: flex; }
}
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
<div class="navwrap"><header class="nav"><a class="brand" href="/"><svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#14241c"/><g fill="#d4e86a"><circle cx="20" cy="18.5" r="11"/><circle cx="44" cy="18.5" r="11"/><path d="M12 36.5c.4-8 7.6-13 20-13s19.6 5 20 13c.7 8.2-4.6 16.2-20 16.2S11.3 44.7 12 36.5z"/></g><g fill="#14241c"><circle cx="20" cy="19.4" r="4.15"/><circle cx="44" cy="19.4" r="4.15"/></g><g fill="#e8f29a"><circle cx="21.35" cy="18.15" r="1.25"/><circle cx="45.35" cy="18.15" r="1.25"/></g><path d="M23.2 42.2c2.9 3.5 14.7 3.5 17.6 0" fill="none" stroke="#14241c" stroke-width="2.45" stroke-linecap="round"/></svg>annotated</a><input id="nav-menu" class="menu-toggle" type="checkbox"><label class="menu" for="nav-menu">Menu</label><nav><a class="item" href="/#product">Features</a><a class="item" href="/#pricing">Pricing</a></nav><a class="cta" href="/#app">Open the app</a></header></div>
<main>
${body}
</main>
<div class="fern"></div>
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
  const page = shell(
    'Redeem annotated',
    `<p class="kicker">${KICKER} AppSumo</p>
<h1>Redeem your code.</h1>
<p class="lede">One code unlocks annotated on one Windows PC. Stack a code for each computer.</p>
<section class="card">
${error ? `<p class="note">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/redeem">
${formFields(code, email)}
</form>
<p class="note">Use the email you want on the license. The same code and email will show this key again.</p>
</section>`,
  )
  return page
}

export function renderSuccess(license) {
  const scriptNonce = nonce()
  const page = shell(
    'Your annotated license',
    `<p class="kicker">${KICKER} License</p>
<h1>Your license is ready.</h1>
<p class="lede">Paste this key into annotated on the Windows PC you want to unlock.</p>
<section class="card">
<label for="key">License key</label>
<textarea id="key" readonly>${escapeHtml(license)}</textarea>
<div class="row">
<button type="button" class="ghost" id="copy">Copy key</button>
<a class="link" href="https://github.com/keithsimkin/crunchcall/releases/latest">Download annotated</a>
</div>
<ol>
<li>Download the Windows app and install it.</li>
<li>Open annotated, go to Settings, then License.</li>
<li>Paste the key and choose Activate.</li>
</ol>
<p class="note">This code stays on that PC. To move it, choose Deactivate this PC in Settings, then License. A second PC needs its own code. The app lives at https://annotated.click.</p>
</section>
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

export const HTML_CONTENT_TYPE = 'text/html; charset=utf-8'

export function securityHeaders(csp) {
  return {
    'content-type': HTML_CONTENT_TYPE,
    // Supabase rewrites text/html to text/plain on GET to *.supabase.co.
    // This header is left alone so the Netlify proxy can put the type back.
    'x-annotated-content-type': HTML_CONTENT_TYPE,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': csp,
  }
}
