# deliverable

Deliverable mode for Localix: when the agent's final reply mentions a produced file by path —
`/tmp/chart.png`, `~/report.pdf` — this plugin attaches the file to the message automatically.
Images render inline, audio as a voice bubble, documents as downloadable chips; channel replies can
deliver them platform-natively.

Hooks-only plugin (`onAssistantMessage`), no tools. Opt-in: enable it in Settings → Capabilities →
Plugins.

## Config

| Key           | Default | Meaning                                              |
| ------------- | ------- | ---------------------------------------------------- |
| `MAX_FILE_MB` | `5`     | Per-file size cap; larger files are skipped.         |
| `MAX_FILES`   | `4`     | Max attachments per reply.                           |
| `STRIP_PATHS` | `false` | Remove bare path lines from the reply once attached. |

## Behavior notes

- Only whitelisted media extensions attach (images, audio, pdf/csv/json/zip, office docs, mp4/webm)
  — never code or logs.
- Paths inside code blocks / inline code are ignored; only prose mentions count.
- Nonexistent paths are skipped silently (the model may speak hypothetically).
- A file that was found but not attached — over the `MAX_FILE_MB` cap, or unreadable — is reported
  as an inline notice in the chat, with the file name and reason. One notice per reply.
