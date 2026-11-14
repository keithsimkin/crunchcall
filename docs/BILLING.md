# Buy Unlock

annotated.click is the Netlify site. Purchase, the account, and the Dodo webhook run as one Supabase Edge Function, `billing`. The pages themselves are part of the Vite build.

## Free trial

The Windows app opens without a hard license wall. Browse meetings and take a tour free. Live cues and other Unlock features run during a seven-day trial, then ask for a license when used.

On first status check the app POSTs `https://annotated.click/api/license/trial` with a SHA-256 of a salt plus the Windows MachineGuid (same device id shape as AppSumo seats). The redeem Edge Function stores that hash on `device_trials` once. Uninstall wipes local cache; the same PC still gets the original start time and does not receive another trial. Offline, the app starts a provisional local trial and reconciles to the cloud start when it can reach the server.

## What the buyer does

1. Click Purchase. The landing button opens `https://annotated.click/buy`.
2. Enter an email. Supabase Auth sends a magic link back to `https://annotated.click/buy`. There is no password.
3. After the link, the page calls `POST /api/checkout`. If this email already has a Dodo license, it opens `/account` instead of charging again.
4. Otherwise Dodo Checkout opens with that email and the Auth user id in metadata.
5. Dodo posts `payment.succeeded` to `https://annotated.click/dodo/webhook`. The function checks the webhook signature, issues one `annotated1` key, stores it on `license_orders` with `max_devices = 1`, and emails it when mail is configured.
6. `/account` lists every key for that email, including AppSumo codes, with copy buttons, a Windows download link, and a deactivate control for each PC.

A Dodo account has one license key. AppSumo codes are extra rows. Each of those keys is one Windows PC (`max_devices = 1`). Older Dodo rows with `max_devices` null stay unlimited. A new Dodo key asks the license API to record this PC. If that call cannot reach the server, the key still unlocks this PC. A second PC is refused once the first activation is on file.

## Download

The account page links to `VITE_WINDOWS_INSTALLER_URL`, or to `https://github.com/keithsimkin/crunchcall/releases/latest` when that variable is empty. Put the signed installer on GitHub Releases, or upload the same file to this Netlify site and set the variable to that URL. `ANNOTATED_INSTALLER_URL` is the same choice for the unused Node license server.

## Email

Sign-in links and license keys both go through Resend (`licensing/mail.mjs`) when `RESEND_API_KEY` and `ANNOTATED_MAIL_FROM` are set on the billing function. `/api/auth/magic-link` asks Supabase Auth for a `hashed_token`, then Resend emails a link to `https://annotated.click/account?token_hash=…` (or `/buy`). The browser finishes sign-in with Auth `verify` so Gmail/Google link prefetch cannot burn the one-time Supabase `/verify` URL, and users land on the account UI (with a clear error if the link is expired or already used) instead of the marketing homepage. License mail still runs from the Dodo webhook after payment. The `from` domain must be verified in Resend.

## Deploy

Nothing in this change was applied.

```bash
supabase link --project-ref nnanwekmhkxcwxrbhtld
supabase db push
supabase secrets set \
  DODO_PAYMENTS_API_KEY=… \
  DODO_PAYMENTS_PRODUCT_ID=pdt_… \
  DODO_PAYMENTS_WEBHOOK_KEY=whsec_… \
  DODO_PAYMENTS_ENV=live \
  RESEND_API_KEY=… \
  ANNOTATED_MAIL_FROM='annotated <hello@annotated.click>'
supabase functions deploy billing
supabase functions deploy redeem
```

`ANNOTATED_LICENSE_PRIVATE_KEY` is already the redeem function's signing key. Set it on the project if it is not there yet. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected. `verify_jwt` is false because Dodo cannot send a Supabase JWT. Checkout and account routes check the user token themselves.

In the Dodo dashboard, the webhook URL is `https://annotated.click/dodo/webhook` and the event is `payment.succeeded`.

In Supabase Auth, set the site URL to `https://annotated.click` and allow these redirects (wildcards included where supported):

- `https://annotated.click` and `https://annotated.click/**`
- `https://annotated.click/buy`, `https://annotated.click/account`
- `https://annotation1.netlify.app` and `https://annotation1.netlify.app/**`
- `http://127.0.0.1:5173/**` and `http://localhost:5173/**`

On the Netlify site `bespoke-cactus-bc1032`, set `VITE_SUPABASE_URL` to `https://nnanwekmhkxcwxrbhtld.supabase.co` and `VITE_SUPABASE_ANON_KEY` to the anon key, then publish `main`. The build stays `bun run build` and the publish directory stays `dist`.

`netlify.toml` proxies:

- `/api/checkout` → `.../functions/v1/billing/api/checkout`
- `/api/auth/magic-link` → `.../functions/v1/billing/api/auth/magic-link`
- `/api/account` and `/api/account/*` → `.../functions/v1/billing/api/account`
- `/dodo/webhook` → `.../functions/v1/billing/dodo/webhook`
- `/buy`, `/account`, `/privacy`, and `/terms` → `/index.html`
