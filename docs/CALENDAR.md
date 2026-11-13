# Calendar

v1 connects Google Calendar and imports a private ICS link or an `.ics` file. Outlook sign-in is parked ([issue 3](https://github.com/keithsimkin/crunchcall/issues/3)). The Microsoft code stays. Connect Outlook is hidden while `microsoftClientId` is empty, and the app does not show an “Outlook sign-in is not set up” message.

## What the desktop app does

- Loopback redirect `http://127.0.0.1:<port>/callback`. The port is chosen when sign-in starts.
- Scope `https://www.googleapis.com/auth/calendar.readonly` (read-only).
- PKCE, plus the desktop client secret on the authorization-code exchange and on every refresh.
- The refresh token stays on this PC. On Windows, Electron `safeStorage` seals it with DPAPI.
- A private `https` or `webcal` link, or an imported `.ics` file, works with no OAuth config.

## Google Cloud setup

1. In Google Cloud Console, select or create a project and enable the Google Calendar API.
2. Configure the OAuth consent screen as External.
3. Add the scope `https://www.googleapis.com/auth/calendar.readonly`.
4. This scope is sensitive. In **Testing**, only Google accounts listed as **Test users** can connect. Add every account that should sign in.
5. Before a public launch, submit the app for Google verification. Until that review finishes, leave the consent screen in Testing. Unverified apps show Google’s warning screen, and accounts that are not test users cannot grant the scope.
6. Create an OAuth client ID of type **Desktop app**. Google desktop clients require the client secret on the token request and on refresh, even when the app sends a PKCE verifier.
7. The app does not pin one port. Google accepts the loopback redirect `http://127.0.0.1` with the port chosen at sign-in, and the path `/callback`.

The public client id for annotated is `333278308187-f51jcakj57d2q3c2bi1v4u3bt2ku03lo.apps.googleusercontent.com`. A different desktop client can override it.

## Local config

Copy `electron/oauth.example.json` to `electron/oauth.local.json` (gitignored) and set `googleClientSecret`. Or put the same values in `.env`. Bun loads `.env` for `bun run desktop` and `bun run desktop:pack`.

| Variable | Config field | Role |
| --- | --- | --- |
| `CRUNCHCALL_GOOGLE_CLIENT_ID` | `googleClientId` | Optional. The public client id is the default. |
| `CRUNCHCALL_GOOGLE_CLIENT_SECRET` | `googleClientSecret` | Required for Connect Google. Never commit it. |
| `CRUNCHCALL_MICROSOFT_CLIENT_ID` | `microsoftClientId` | Leave empty. Connect Outlook stays hidden. |

Runtime order, per field: environment variable, then `electron/oauth.local.json`, then the packaged `electron/oauth.json`, then the built-in public Google client id. The secret has no built-in default. Connect Google appears only when both the client id and the client secret are present.

## Installer

`bun run desktop:pack` runs `scripts/write-oauth-config.mjs` before electron-builder. The script writes `electron/oauth.json` (gitignored, mode `0600`) from those environment variables, or from `oauth.local.json` when a variable is empty. electron-builder ships `oauth.json` and excludes `oauth.local.json`.

A pack without the secret still builds. Connect Google stays hidden in that copy, and the script prints a warning that does not include the secret. Set `CRUNCHCALL_GOOGLE_CLIENT_SECRET` in the pack environment when the installer should offer one-click Google connect.

## GitHub Actions

This repo has no release workflow. When you add one, store these repository secrets and pass them to the pack step under the same names:

- `CRUNCHCALL_GOOGLE_CLIENT_ID`
- `CRUNCHCALL_GOOGLE_CLIENT_SECRET`
- `CRUNCHCALL_MICROSOFT_CLIENT_ID` (empty while Outlook is parked)

The client id may be omitted. The pack script falls back to the public default. The secret must be set for the installed app to offer Connect Google.

## ICS

Calendar and onboarding always show the link field and **Import .ics**. That path does not read the OAuth config. In the desktop app the link block is for Apple, Outlook, or another calendar. In the browser, paste a link or import a file. Google sign-in is desktop-only.
