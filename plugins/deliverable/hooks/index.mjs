/**
 * `deliverable` plugin — hooks-only (no tools): when the agent's final reply
 * mentions produced files by path (e.g. `/tmp/chart.png` or `~/report.pdf`),
 * the `onAssistantMessage` hook reads them and attaches them to the message —
 * images render inline, audio as a voice bubble, documents as download chips,
 * and channel replies can deliver them platform-natively.
 *
 * A Localix assistant-message hook. Dependency-free: `node:` builtins only.
 *
 * Safety: only files with a whitelisted media extension attach (never code,
 * logs, or extension-less paths), each capped at MAX_FILE_MB, at most MAX_FILES
 * per reply. Paths inside fenced code blocks or inline code spans are ignored —
 * code talks ABOUT paths; prose mentions deliver them.
 *
 * WHY A SKIP IS REPORTED. Those safety rules are the whole plugin, and every one of
 * them used to fail silently into `ctx.log`: the agent says "here is your report",
 * the file is 6MB against a 5MB cap, and the person gets a reply with nothing
 * attached and no reason. A skip is not an error — the run succeeded — but it is
 * exactly the kind of standing condition a person has to be told about, because the
 * fix (raise MAX_FILE_MB) is theirs and they cannot guess it. `ctx.reportProblem`
 * states it once per reply; a missing file stays silent, because a reply merely
 * TALKING about a path is the common case and never was a deliverable.
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** extension → { kind, mediaType }. Whitelist = the attachment kinds the UI renders. */
const MEDIA_TYPES = {
  // images (inline thumbnails)
  png: { kind: 'image', mediaType: 'image/png' },
  jpg: { kind: 'image', mediaType: 'image/jpeg' },
  jpeg: { kind: 'image', mediaType: 'image/jpeg' },
  gif: { kind: 'image', mediaType: 'image/gif' },
  webp: { kind: 'image', mediaType: 'image/webp' },
  svg: { kind: 'file', mediaType: 'image/svg+xml' },
  // audio (voice bubble)
  mp3: { kind: 'audio', mediaType: 'audio/mpeg' },
  wav: { kind: 'audio', mediaType: 'audio/wav' },
  ogg: { kind: 'audio', mediaType: 'audio/ogg' },
  m4a: { kind: 'audio', mediaType: 'audio/mp4' },
  // documents / data (download chips)
  pdf: { kind: 'file', mediaType: 'application/pdf' },
  csv: { kind: 'file', mediaType: 'text/csv' },
  json: { kind: 'file', mediaType: 'application/json' },
  zip: { kind: 'file', mediaType: 'application/zip' },
  docx: {
    kind: 'file',
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    kind: 'file',
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  pptx: {
    kind: 'file',
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  mp4: { kind: 'file', mediaType: 'video/mp4' },
  webm: { kind: 'file', mediaType: 'video/webm' },
}

const EXT_ALTERNATION = Object.keys(MEDIA_TYPES).join('|')
/**
 * Absolute or ~-relative paths ending in a whitelisted extension. Exported for tests.
 *
 * Written as segments-separated-by-`/`-or-space (`(?:[\w.\-~]+[/ ])* basename.ext`) rather
 * than the tempting `[\w.\-~/ ]*?[\w.\-]+\.ext`: those two adjacent quantifiers overlap on
 * `[\w.\-]`, so a long unbroken run after a `/` with no valid extension backtracked
 * QUADRATICALLY (~400ms at 32k chars, seconds at 100k+). This hook runs on every assistant
 * message — which can echo large external content — so that was a real stall. The segment
 * form is unambiguous (each segment is pinned by its trailing separator) and stays linear,
 * with byte-identical matches on real paths.
 */
export const PATH_RE = new RegExp(
  String.raw`(?:~/?|/)(?:[\w.\-~]+[/ ])*[\w.\-~]+\.(?:${EXT_ALTERNATION})\b`,
  'gi',
)

/** Strip fenced blocks and inline code — paths there are notation, not deliverables. */
export function proseOnly(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
}

export function register(ctx) {
  const maxBytes = ctx.helpers.configNumber(ctx.config.MAX_FILE_MB, 5) * 1024 * 1024
  const maxFiles = ctx.helpers.configNumber(ctx.config.MAX_FILES, 4)
  const stripPaths = ctx.helpers.configBoolean(ctx.config.STRIP_PATHS, false)

  return {
    tools: [],
    hooks: {
      async onAssistantMessage({ content, sessionId }) {
        const candidates = [...new Set(proseOnly(content).match(PATH_RE) ?? [])]
        if (candidates.length === 0) return

        const bindings = []
        const attached = []
        // What was found but not delivered. One line per reply, not one per file:
        // the fix is the same for all of them.
        const skipped = []
        for (const raw of candidates) {
          if (bindings.length >= maxFiles) break
          const filePath = raw.startsWith('~') ? path.join(homedir(), raw.slice(1)) : raw
          const meta = MEDIA_TYPES[path.extname(filePath).slice(1).toLowerCase()]
          if (!meta) continue
          try {
            const stat = await fs.stat(filePath)
            if (!stat.isFile()) continue
            if (stat.size > maxBytes) {
              ctx.log(`skipped ${filePath} (${stat.size} bytes > cap)`)
              skipped.push(
                `${path.basename(filePath)} — ${stat.size} bytes, over the MAX_FILE_MB cap (${maxBytes})`,
              )
              continue
            }
            const data = (await fs.readFile(filePath)).toString('base64')
            bindings.push({
              kind: meta.kind,
              mediaType: meta.mediaType,
              data,
              name: path.basename(filePath),
              size: stat.size,
            })
            attached.push(raw)
          } catch (err) {
            // A path the reply merely talked about is the common case, so a missing
            // file is silent; anything else (permissions, a bad read) is a real
            // deliverable being dropped and worth a line in the log.
            if (err?.code !== 'ENOENT') {
              ctx.log(`skipped ${filePath}: ${err?.message ?? err}`)
              skipped.push(`${path.basename(filePath)} — ${err?.message ?? err}`)
            }
          }
        }
        if (skipped.length > 0) {
          ctx.reportProblem?.({
            sessionId,
            message:
              skipped.length === 1
                ? 'A file this reply produced was not attached'
                : `${skipped.length} files this reply produced were not attached`,
            detail: skipped.join('\n'),
            source: 'onAssistantMessage',
          })
        }
        if (bindings.length === 0) return

        if (!stripPaths) return { bindings }
        // Remove only lines that are JUST an attached path (with list/bold dressing);
        // paths woven into sentences stay — stripping those would break the prose.
        const bare = new RegExp(
          `^\\s*(?:[-*]\\s*)?\\*{0,2}(?:${attached.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\*{0,2}\\s*$`,
        )
        const stripped = content
          .split('\n')
          .filter((line) => !bare.test(line))
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
        return stripped && stripped !== content ? { content: stripped, bindings } : { bindings }
      },
    },
  }
}
