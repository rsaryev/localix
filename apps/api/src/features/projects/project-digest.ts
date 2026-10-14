/**
 * Pure builder for the `@project:<id>` context-ref expansion — a COMPACT,
 * token-economical digest of a project (folder scope): its name, working
 * directory, and a bounded roster of its recent chat sessions. Symmetric to the
 * `@session:` digest (`session-digest.ts`).
 *
 * SECURITY: this deliberately carries INTROSPECTION ONLY — the project name, its
 * own working-directory path (already visible to the user in the composer context
 * bar), and session titles/status. It NEVER inlines connection credentials,
 * secrets, environment variables, a git remote URL, or file contents. Keep it that
 * way when extending — an expansion must not be able to leak a secret.
 *
 * Kept free of DB / IO so the formatting + trimming rules stay unit-testable; the
 * data is loaded by the caller (bootstrap) and mapped into `ProjectDigestInput`.
 */

/** One session in the project's roster, already reduced to plain fields. */
import { plural } from '../../lib/plural'

export interface DigestSession {
  title: string
  runtimeStatus: string
  /** ISO timestamp of last activity. */
  updatedAt: string
}

export interface ProjectDigestInput {
  id: string
  name: string
  /** Absolute working directory of the project (the folder it scopes). */
  workingDir: string
  /** Total root chat sessions in the project (may exceed the shown roster). */
  sessionCount: number
  /** Recent sessions, newest → oldest (already the trimmed head). */
  sessions: DigestSession[]
}

/** Max sessions listed in the roster. */
export const PROJECT_DIGEST_MAX_SESSIONS = 12
/** Max chars kept from a session title. */
const TITLE_CHARS = 80

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max).trimEnd()}…` : s

const oneLineDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10)
}

/**
 * Renders the project digest markdown block. Size stays small: an identity header
 * (name + working dir) and up to `PROJECT_DIGEST_MAX_SESSIONS` session rows.
 */
export function buildProjectDigest(input: ProjectDigestInput): string {
  const lines: string[] = []
  const name = input.name.trim() || '(unnamed project)'
  lines.push(`Project "${name}"`)
  lines.push(`Working directory: ${input.workingDir}`)
  lines.push(`${plural(input.sessionCount, 'chat session')} in this project.`)

  const shown = input.sessions.slice(0, PROJECT_DIGEST_MAX_SESSIONS)
  if (shown.length > 0) {
    lines.push('')
    lines.push(
      `Recent sessions (${shown.length}${input.sessionCount > shown.length ? ` of ${input.sessionCount}` : ''}):`,
    )
    for (const s of shown) {
      const title = truncate((s.title || '(untitled)').replace(/\s+/g, ' ').trim(), TITLE_CHARS)
      lines.push(`- ${title} · ${s.runtimeStatus} · updated ${oneLineDate(s.updatedAt)}`)
    }
  }

  lines.push('')
  lines.push('(Compact project digest. Use the file/search tools to read its code.)')
  return lines.join('\n')
}
