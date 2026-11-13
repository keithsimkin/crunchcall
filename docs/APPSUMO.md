# AppSumo codes

Each AppSumo code unlocks annotated on one Windows PC. Buyers stack codes: one code is one PC, two codes are two PCs, three codes are three PCs. A code is not a shared login. Dodo purchases stay unlimited and still unlock offline with no call to this service.

Redeem URL: `https://annotated.click/redeem`

## Redemption text for the AppSumo deal

Paste this into the deal's redemption steps:

```text
1. Open https://annotated.click/redeem
2. Enter your AppSumo code and the email you want on the license.
3. Copy the license key.
4. Download annotated for Windows from https://annotated.click and install it.
5. Open annotated, go to Settings, then License, paste the key, and choose Activate.

Each code activates one Windows PC. Tier 1 is 1 code (1 PC), tier 2 is 2 codes (2 PCs), and tier 3 is 3 codes (3 PCs). Repeat the steps on each computer.

To move a code, open annotated on the old PC, go to Settings, then License, and choose Deactivate this PC. On the new PC, open https://annotated.click/redeem with the same code and email to copy the key, then Activate.
```

## What was not deployed

Nothing in this change was applied to Supabase or Cloudflare. The project ref is `nnanwekmhkxcwxrbhtld`. Run the commands below from a machine that is logged into both.

The zone `annotated.click` has to be on the same Cloudflare account as the Worker, with a proxied DNS record, because the Worker is attached with routes rather than as the origin for the whole site. Paths outside `/redeem*` and `/api/license/*` stay on the existing host. Attach a rate limiting rule to `POST /redeem` and `POST /api/license/*` (for example 10 and 30 requests per minute per IP). `workers_dev` is off so the Worker is not also published on a `workers.dev` hostname.

## 1. Database

The migration is `supabase/migrations/20261113110000_appsumo_licensing.sql`. It creates `license_orders` (with `max_devices`), `appsumo_codes`, and `license_activations`, enables RLS, and grants no anon or authenticated access to codes or activations. Buyers can still select their own `license_orders` rows. Seat changes are `security invoker` functions with `search_path` fixed, executable by `service_role` only.

`max_devices` null means unlimited. That is the Dodo behavior. Each AppSumo redemption inserts `max_devices = 1`.

```bash
supabase link --project-ref nnanwekmhkxcwxrbhtld
supabase db push
```

Or paste the migration into the Supabase SQL editor for that project. Then open Database Advisors and confirm there are no new warnings. Codes are claimed by `UPDATE ... WHERE redeemed_at IS NULL`, not by a security-definer function.

## 2. Generate and import codes

Codes look like `ANN-XXXX-XXXX-XXXX` (Crockford base32). AppSumo accepts 3–200 characters matching `[A-Za-z0-9_-]`. Annotated stores 3–120 characters so `appsumo_` plus the code still fits the license order id (8–128 characters). The default batch is 1000 codes, which is AppSumo's minimum upload.

```bash
bun scripts/appsumo-generate-codes.mjs --count 1000
```

That writes three files under `.appsumo-codes/` (gitignored):

- `codes.csv` — header `code`, one code per line. Upload this file to AppSumo.
- `appsumo_codes.sql` — `insert` into `public.appsumo_codes`. Run it in the SQL editor as the database owner.
- `appsumo_codes.json` — the same batch, for a service-role import if you prefer the REST API.

Do not commit that folder. Anyone with the CSV can redeem a code until it is claimed.

## 3. Worker

From `workers/redeem`:

```bash
npx wrangler secret put ANNOTATED_LICENSE_PRIVATE_KEY < ../../licensing/private.pem
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

`ANNOTATED_LICENSE_PRIVATE_KEY` is the PKCS8 Ed25519 PEM that matches `electron/license-public.pem`. The Worker signs `annotated1.<payload>.<sig>` with WebCrypto over the same canonical JSON the app verifies. `SUPABASE_URL` is `https://nnanwekmhkxcwxrbhtld.supabase.co`. Use the service-role key, not the anon key. Secrets are not written into `wrangler.toml`.

For local `wrangler dev`, copy `workers/redeem/.dev.vars.example` to `.dev.vars` and fill it in. `.dev.vars` is gitignored.

Routes:

- `annotated.click/redeem*` — `GET` shows the form, `POST` claims the code and shows the key.
- `annotated.click/api/license/activate` — verifies the key and takes a seat.
- `annotated.click/api/license/deactivate` — frees that PC's seat.

Submitting a redeemed code with the same email returns the same key. A different email is rejected. Responses do not include the private key, the service-role key, or another buyer's email.

## 4. What the Windows app does

On Activate, a Dodo key is still checked on this PC and stored for offline use. No network call.

An order id that starts with `appsumo_` calls `https://annotated.click/api/license/activate` with a SHA-256 of a salt plus the Windows MachineGuid (or `/etc/machine-id` on Linux). The raw machine id is not sent. A successful activation is cached in `license-seat.json`. The app keeps working offline after that. It re-checks about once a day. If the server cannot be reached, a PC that already activated stays unlocked. If the server says the code is active on another PC, Settings → License shows that message and tells the buyer to deactivate the other PC. Deactivate this PC calls `/api/license/deactivate` and, only after the server accepts it, removes the local key.
