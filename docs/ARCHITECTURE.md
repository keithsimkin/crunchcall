# Architecture

> **Superseded.** Canonical architecture (Tauri 2 + Rust core, audio, STT, LLM, overlay, storage, MCP) lives in [`PLAN.md`](./PLAN.md). Do not treat this file as source of truth.

## Layers

```
UI (React)
  → features/meetings | notes | coaching
  → features/audio   (capture adapters)
  → features/llm     (local | byok providers)
    → lib/storage      (local meeting store)
```

Desktop host (Electron or Tauri) will own mic/system-audio permissions and overlay windows. The Vite app stays the renderer / UI until that shell lands.

## LLM modes

| Mode | Audio | Text / summaries |
| --- | --- | --- |
| `local` (default) | Never leaves device | Local model |
| `byok` | Never leaves device | User's Claude or OpenAI key |

## Evidence / research

Competitor internals (if studied) stay behind a clean-room spec in `docs/research/`. Implementation is written from behavior specs only.
