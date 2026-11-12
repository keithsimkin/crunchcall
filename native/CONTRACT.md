# annotated engine contract

The renderer, Electron main, and `crunchcalld` share this contract. Do not invent a second protocol.

## Process

- Binary name: `crunchcalld` (`crunchcalld.exe` on Windows).
- Electron spawns it and speaks newline-delimited JSON on stdin/stdout.
- stdout is protocol only. Logs go to stderr.
- One request in flight at a time. One response line per request.

Request:

```json
{"id":1,"method":"catalog.list","params":{}}
```

Success:

```json
{"id":1,"ok":true,"result":{}}
```

Failure:

```json
{"id":1,"ok":false,"error":{"code":"engine_not_linked","message":"Whisper Tiny is downloaded. whisper.cpp is not linked in this build yet."}}
```

## Data locations

- Database: `%LOCALAPPDATA%\CrunchCall\crunchcall.db`
- Models: `%LOCALAPPDATA%\CrunchCall\models\<module id>\<filename>`
- Override both with `CRUNCHCALL_DATA_DIR` for tests.
- Secrets go to Windows Credential Manager (`keyring` service name `CrunchCall`, account = module id). Never write a secret into SQLite. SQLite may store the credential target name only.

## Catalog

`native/catalog/providers.json` is the only provider list. Load it at runtime from the file next to the source during dev, and from the crate via `include_str!` so the binary still works when the file is not beside the exe.

`clientReady: false` means the module is selectable and described honestly, and calls return `not_ready` with a clear message. Do not pretend a call succeeded.

Local speech and local writers download when `download` is `direct` and `downloadUrl` is set. `gated` and `manual` return a message that names the model and does not invent a URL. Inference for `whisper.cpp`, `sherpa-onnx`, and `llama.cpp` returns `engine_not_linked` until those libraries are linked. Downloads themselves must work.

## Methods

- `ping` → `{ "name": "crunchcalld", "version": "0.1.0" }`
- `catalog.list` → the parsed catalog plus defaults
- `settings.get` / `settings.set` `{ "values": { "speech": "...", "writer": "...", "coach": "...", "coachPack": "...", "language": "auto", "modelOverrides": {} } }`
- `secrets.put` `{ "moduleId", "key" }` / `secrets.has` `{ "moduleId" }` / `secrets.delete` `{ "moduleId" }` — `has` returns `{ "saved": true|false }` and never the key
- `models.list` → install rows `{ moduleId, status, path, bytesDone, bytesTotal, speedBps, message, updatedAt }`
- `models.install` `{ "moduleId" }` → starts a direct download, or resumes a paused one. Returns immediately. A second install while that download is still running does not start another copy. `gated` and `manual` return a message and do not touch the network.
- `models.pause` `{ "moduleId" }` → stops the running download, keeps the partial file, sets `status` to `paused` and `speedBps` to 0.
- `models.resume` `{ "moduleId" }` → continues a paused or failed direct download from the partial file with an HTTP Range request.
- `models.status` `{ "moduleId" }` → the same install row. `speedBps` is bytes per second while `status` is `downloading`, and 0 otherwise. Poll `models.list` or `models.status` for progress.

A direct download writes `models/<module id>/<filename>.partial` and renames it when the file is complete. Pause and a failed attempt leave the partial in place. Opening the engine marks an in-progress download as `paused` (“Paused when the app closed.”) so Continue can resume it. `speed_bps` is stored on `installed_modules` (schema user_version 2).
- `meetings.create|list|get|update`
- `utterances.append|list`
- `notes.get|put`
- `actions.list|replace`
- `search.query` `{ "q" }` over FTS5
- `coach.scan` `{ "lines": ["..."], "pack": "crisp" }` → cue objects from the rules engine. Packs only change the wording.
- `dictate.start` `{ "moduleId", "sampleRate" }` → `{ "sessionId" }`
- `dictate.push` `{ "sessionId", "pcmBase64" }` — for cloud modules, buffer. For local unlinked modules, return `engine_not_linked` and do not write the audio to disk.
- `dictate.stop` `{ "sessionId" }` → final text, and a `dictations` row
- `dictate.commit` `{ "text", "moduleId", "meetingId"? }` — for Willow-style handoff. Stores text only.
- `dictate.list` `{ "limit" }`
- `speech.transcribe` `{ "moduleId", "wavBase64" }`
- `writer.complete` `{ "moduleId", "system", "prompt" }` — cloud clients that are `clientReady` perform the HTTP call. Local writers return `engine_not_linked`. Missing key returns `missing_key`.

## Cloud clients that must really call

- `openai-audio`: multipart `POST {baseUrl}/audio/transcriptions` fields `file`, `model`. Bearer key.
- `openai-chat`: `POST {baseUrl}/chat/completions`. Bearer key. OpenRouter also sends `HTTP-Referer: https://annotated.click`.
- `anthropic`: `POST https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01`.
- `google`: Gemini `generateContent`. Speech sends inline audio plus "Transcribe this audio verbatim." Writer sends the prompt.
- `cohere`: `POST https://api.cohere.com/v2/chat` with `Authorization: Bearer`.
- `deepgram`: `POST {baseUrl}?model=` raw audio, header `Authorization: Token {key}`.
- `assemblyai`: upload then transcript submit. Return the transcript id and text when the API already includes it; if the job is async, return `{ "pending": true, "id": "..." }` rather than a fake transcript.
- `elevenlabs`: multipart to the module baseUrl, header `xi-api-key`, field `model_id`.

## Coaching rules

Always local. Kinds stay `talk-ratio`, `stacked-questions`, `no-date`, `no-next-steps`, `interrupt`.

- talk-ratio: one speaker label (prefix `Name:`) covers 70% or more of at least 6 lines.
- stacked-questions: 3 of the last 4 lines contain `?`.
- no-date: a line contains commit words (by, ship, send, deliver, finish) and no weekday or month or `today`/`tomorrow`/`\\d`.
- no-next-steps: at least 8 lines and none contain owner/next words (will, owner, action, next step, I'll, I will).
- interrupt: a line contains `[overlap]` or `—` cut short under 4 words after another speaker.

Packs rewrite `message` only. `coach.rules` uses the crisp wording.

## SQLite

rusqlite, bundled, FTS5. Tables: `meetings`, `utterances`, `utterance_fts`, `notes`, `action_items`, `coaching_cues`, `dictations`, `app_settings`, `installed_modules`, `secret_refs`. WAL. Foreign keys on.

## Tests

Use a temp `CRUNCHCALL_DATA_DIR`. Cover migrate, meeting + utterance + FTS, settings roundtrip, secret store does not put the key in the db file (use an in-memory secret store in tests), coach.scan fires no-next-steps, catalog ids are unique, openai request builder does not send when the key is empty.

Do not download models in tests.
