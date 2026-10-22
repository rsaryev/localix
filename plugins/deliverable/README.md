# Deliverables

Deliverable mode for Localix: when the agent's final reply mentions a produced file by path —
`/tmp/chart.png`, `~/report.pdf` — this plugin attaches the file to the message automatically.
Images render inline, audio as a voice bubble, documents as downloadable chips; channel replies can
deliver them platform-natively.

Hooks-only plugin (`onAssistantMessage`), with no agent tools. The bundled manifest enables it by
default; an agent’s plugin rules can disable it in **Settings → Capabilities → Plugins**.

## Config

| Key           | Default | Meaning                                              |
| ------------- | ------- | ---------------------------------------------------- |
| `MAX_FILE_MB` | `5`     | Per-file size cap; larger files are skipped.         |
| `MAX_FILES`   | `4`     | Max attachments per reply.                           |
| `STRIP_PATHS` | `false` | Remove bare path lines from the reply once attached. |

## Behavior notes

- Only whitelisted media extensions attach (images, audio, pdf/csv/json/zip, office docs, mp4/webm)
  — never code or logs.
- Triple-backtick fenced blocks and inline backtick spans are removed before path matching.
- Nonexistent paths are skipped silently (the model may speak hypothetically).
- A file that was found but not attached — over the `MAX_FILE_MB` cap, or unreadable — is reported
  as an inline notice in the chat, with the file name and reason. One notice per reply.

## Limits

- Path recognition is a text matcher for slash-style absolute and `~` paths, not a general path
  parser. Windows drive/backslash paths are unsupported.
- SVG, MP4, and WebM attach as files, not as image or audio bindings.
- The attachment limit counts successfully attached files. Once reached, later candidates are not
  read.
- `STRIP_PATHS` removes only whole lines containing an attached path with optional list or bold
  markers; paths embedded in sentences remain.

## Source of truth

- [Plugin manifest](.claude-plugin/plugin.json) and [mini app manifest](.localix-app/app.json)
- [Path matching, file caps, and attachment bindings](hooks/index.mjs)
