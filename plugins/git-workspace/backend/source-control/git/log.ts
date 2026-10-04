/**
 * Commit history for the git backend. One `git log` read, parsed into compact
 * records for the Source Control graph. Field-separated by US (\x1f) and
 * record-separated by RS (\x1e) so subjects/authors with arbitrary characters
 * parse cleanly.
 */
import type { LogFilter, RepoCommit, RepoRef } from '../contracts'
import type { GitRunner } from './cli'

const FIELD = '\x1f'
const RECORD = '\x1e'
// `%D` = the ref decorations of the commit. Read with `--decorate=full` (see
// `buildLogArgs`) so every token is a FULL ref path (`refs/heads/…`,
// `refs/remotes/…`, `refs/tags/…`) — unambiguous, unlike the short form where a
// local `feature/x` and a remote `origin/x` are indistinguishable.
// `%P` = the parent hashes (space-separated, first-parent first). Drives the
// commit-graph lane/rail visualization (merge = 2+ parents, root = none).
const FORMAT = ['%H', '%h', '%an', '%ad', '%s', '%D', '%P'].join(FIELD) + RECORD

/** The Co-Authored-By trailer our commit path appends — stripped when we surface a message for editing. */
const COAUTHOR_TRAILER = /\n+Co-Authored-By: Localix <noreply@localix\.ai>\s*$/
/** Record separator injected between messages by `%x1e` so bodies split cleanly. */
const RECORD_SEP = '\x1e'

/**
 * Normalize a raw commit message for editing: drop trailing blank lines and OUR
 * Co-Authored-By trailer (so re-committing doesn't duplicate it — `withCoAuthor`
 * re-adds it on write), keeping any foreign co-author intact. Empty → null.
 */
function cleanMessage(raw: string): string | null {
  return raw.replace(/\n+$/, '').replace(COAUTHOR_TRAILER, '').trimEnd() || null
}

/**
 * Full message of the current HEAD commit (subject + body), or null on an unborn
 * branch. The localix Co-Authored-By trailer is stripped so re-amending doesn't
 * show (or duplicate) it in the editor — `withCoAuthor` re-adds it on write.
 */
export async function getHeadCommitMessage(run: GitRunner): Promise<string | null> {
  const res = await run(['log', '-1', '--pretty=format:%B'])
  if (!res.ok) return null
  return cleanMessage(res.stdout)
}

/**
 * The last `limit` commit messages (full body, newest first) for composer recall
 * — press ↑/↓ to cycle recent messages back into the commit field. Each message
 * is cleaned like `getHeadCommitMessage` (trailer stripped) and consecutive
 * duplicates are collapsed so a re-worded amend doesn't show twice in a row.
 */
export async function getRecentCommitMessages(run: GitRunner, limit: number): Promise<string[]> {
  const res = await run(['log', '-n', String(limit), `--pretty=format:%B${RECORD_SEP}`])
  if (!res.ok) return []
  const messages: string[] = []
  for (const record of res.stdout.split(RECORD_SEP)) {
    const cleaned = cleanMessage(record.replace(/^\n+/, ''))
    if (!cleaned) continue
    if (messages[messages.length - 1] === cleaned) continue
    messages.push(cleaned)
  }
  return messages
}

/**
 * Build the `git log` argv for an optional filter. Each filter value rides on a
 * single `--flag=<value>` token (or after `--` for a path), so a value can NEVER
 * be read as a git flag — no shell, no interpolation, no arg injection. A blank
 * (whitespace-only) value is dropped so an empty search box = the normal log.
 * `--grep`/`--author` are case-insensitive (`-i`). A `path` becomes a trailing
 * pathspec (`-- <path>`), which git requires to come last.
 */
export function buildLogArgs(limit: number, filter?: LogFilter): string[] {
  const args = [
    'log',
    '-n',
    String(limit),
    `--pretty=format:${FORMAT}`,
    '--date=relative',
    '--decorate=full',
  ]
  const query = filter?.query?.trim()
  const author = filter?.author?.trim()
  const path = filter?.path?.trim()
  if (query || author) args.push('-i')
  if (query) args.push(`--grep=${query}`)
  if (author) args.push(`--author=${author}`)
  if (path) args.push('--', path)
  return args
}

/**
 * Classify ONE full ref path (as produced by `--decorate=full`) into a display
 * ref, or null to drop it. Tolerant of the short (`--decorate`) form too, and of a
 * leading `tag: ` marker git prints for tags. Remote `…/HEAD` symbolic refs (e.g.
 * `origin/HEAD`) are dropped — they're noise, not a real branch head.
 */
function classifyRef(token: string): RepoRef | null {
  let s = token.trim()
  if (!s) return null
  let taggish = false
  if (s.startsWith('tag: ')) {
    taggish = true
    s = s.slice(5).trim()
  }
  if (s.startsWith('refs/tags/')) return { kind: 'tag', name: s.slice('refs/tags/'.length) }
  if (taggish) return { kind: 'tag', name: s }
  if (s.startsWith('refs/remotes/')) {
    const name = s.slice('refs/remotes/'.length)
    if (!name || name.endsWith('/HEAD')) return null
    return { kind: 'remote', name }
  }
  if (s.startsWith('refs/heads/')) return { kind: 'branch', name: s.slice('refs/heads/'.length) }
  // A full ref path (`refs/…`) outside the three known namespaces — e.g. the
  // `refs/bisect/bad` / `refs/bisect/good-<sha>` pseudo-refs git writes during a
  // bisect — is internal plumbing, NOT a branch head. Drop it rather than letting
  // the short-form fallback below mis-classify it as a dimmed remote chip.
  if (s.startsWith('refs/')) return null
  // Short-form fallback: a bare name from `--decorate` (not full). Slash → remote.
  if (s.endsWith('/HEAD')) return null
  return s.includes('/') ? { kind: 'remote', name: s } : { kind: 'branch', name: s }
}

/**
 * Parse the `%D` decoration string of ONE commit into display refs. Handles the
 * `HEAD -> refs/heads/<branch>` form (marks that branch `current` and floats it
 * first), a bare `HEAD` (detached marker), and drops empty/`…/HEAD` tokens. Pure —
 * unit-tested; the risky part of this feature.
 */
export function parseCommitRefs(decoration: string): RepoRef[] {
  const raw = decoration?.trim()
  if (!raw) return []
  const refs: RepoRef[] = []
  let current: RepoRef | null = null
  for (const token of raw.split(',')) {
    const tok = token.trim()
    if (!tok) continue
    const arrowAt = tok.indexOf('->')
    if (arrowAt !== -1 && tok.slice(0, arrowAt).trim() === 'HEAD') {
      const ref = classifyRef(tok.slice(arrowAt + 2))
      if (ref) {
        ref.current = true
        current = ref
      }
      continue
    }
    if (tok === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' })
      continue
    }
    const ref = classifyRef(tok)
    if (ref) refs.push(ref)
  }
  return current ? [current, ...refs] : refs
}

export async function getLog(
  run: GitRunner,
  limit: number,
  filter?: LogFilter,
): Promise<RepoCommit[]> {
  const res = await run(buildLogArgs(limit, filter))
  if (!res.ok) return []
  const commits: RepoCommit[] = []
  for (const record of res.stdout.split(RECORD)) {
    const line = record.replace(/^\n/, '')
    if (!line.trim()) continue
    const [hash, shortHash, author, relativeDate, subject, decoration, parentField] =
      line.split(FIELD)
    if (!hash) continue
    const refs = parseCommitRefs(decoration ?? '')
    const parents = (parentField ?? '').trim().split(/\s+/).filter(Boolean)
    commits.push({
      hash,
      shortHash: shortHash ?? hash.slice(0, 7),
      author: author ?? '',
      relativeDate: relativeDate ?? '',
      subject: subject ?? '',
      ...(refs.length ? { refs } : {}),
      ...(parents.length ? { parents } : {}),
    })
  }
  return commits
}
