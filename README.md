# annotated

**Annotate every call.** Local-first AI notepad for meetings, at [annotated.click](https://annotated.click). Speech and notes stay on this PC unless you pick a cloud engine. Dictate in the app with the same speech model you use on the call, or hand the text over from Willow and the other dictation apps.

annotated sits between [MeetMouse](https://meetmouse.com/) (on-device privacy + live coaching) and [Granola](https://www.granola.ai/) (polish, memory, shareable notes). No bot joins your call.

## Name

**annotated** — notes, owners, and next steps from the calls you already take. The product lives at [annotated.click](https://annotated.click).

## Stack (v0)

- Vite + React + TypeScript — disposable UI scaffold
- Desktop shell — Electron + Rust native/sidecar (see `docs/PLAN.md`)
- Speech and notes on this PC by default. Cloud labs are optional and labeled.
- Dictate in the app, or paste from Willow, Wispr, Superwhisper, and the other dictation apps

## Develop

```bash
bun install
bun run dev
```

Build: `bun run build`

Windows installer: `bun run desktop:pack` (writes `electron/oauth.json`, then `electron-builder --win`).

## Google Calendar

Connect Google is desktop-only. The public client id is `333278308187-f51jcakj57d2q3c2bi1v4u3bt2ku03lo.apps.googleusercontent.com`. Google’s desktop clients also require a client secret on the token exchange and on refresh, even with PKCE. Do not commit the secret.

Set `CRUNCHCALL_GOOGLE_CLIENT_SECRET` in `.env` or `googleClientSecret` in `electron/oauth.local.json` (copy `electron/oauth.example.json`). Optional overrides: `CRUNCHCALL_GOOGLE_CLIENT_ID`, `CRUNCHCALL_MICROSOFT_CLIENT_ID`.

Runtime order, per field: environment variable, then `electron/oauth.local.json`, then the packaged `electron/oauth.json`, then the built-in public Google client id. Connect Google stays hidden until both the id and the secret are present. Connect Outlook stays hidden while `microsoftClientId` is empty. A private ICS link or an imported `.ics` file needs no OAuth.

While the Google app is in Testing, only listed test users can sign in. `calendar.readonly` is a sensitive scope and needs Google verification before a public launch. Outlook sign-in is parked. See [`docs/CALENDAR.md`](docs/CALENDAR.md).

There is no GitHub Actions release workflow in this repo. When you add one, pass `CRUNCHCALL_GOOGLE_CLIENT_ID`, `CRUNCHCALL_GOOGLE_CLIENT_SECRET`, and `CRUNCHCALL_MICROSOFT_CLIENT_ID` from repository secrets into the pack step. The secret has no default.

## Demo surfaces

The scaffold ships clickable versions of the three things that make a note worth keeping:

- **Projects** (`Ctrl+6`, search with `Ctrl+4`) — one desk for folders and search. It matches titles, people, topics, summaries, next steps, and transcript lines, then shows the matching note on the desk with the excerpt highlighted. Opening a folder spreads its notes out. `New folder` files new calls as they land, and anything unfiled sits in `Unfiled`.
- **Connect** (`Ctrl+8`) — a local, read-only MCP server so Claude, Cursor, ChatGPT, and other MCP clients can read the notes on this PC. Copy a client config from the screen, or run the demo server yourself:

  ```bash
  bun run mcp
  ```

  No audio, no API keys, no edits. See [`docs/MCP.md`](docs/MCP.md) for client setup and the five exposed tools.

## Product north star

1. Capture meeting audio without inviting a bot
2. Transcribe and summarize on-device by default
3. Nudge you *during* the call when it still matters
4. Leave every meeting with notes, owners, and next steps
5. Optionally send text, or speech, to a lab you pick with your own key. The screen says which one leaves the PC.
