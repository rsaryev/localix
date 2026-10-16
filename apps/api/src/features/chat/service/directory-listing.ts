import { readdir } from 'node:fs/promises'
import { ApiError } from '../../../lib/errors'
import { shellQuote, type ExecutionEnvironment } from '../../agent-core/tools/environment'
import { openSessionEnv, resolveAgainst, type FileOpsContext } from './file-ops-context'
import type { DirEntry, DirListing } from '../contracts'

/** Max entries a single directory listing returns before it's capped (see {@link listDirectory}). */
const DIR_ENTRY_LIMIT = 1000
/** Bytes that always fit {@link DIR_ENTRY_LIMIT} far-side records: NAME_MAX + `./` + NUL each, plus the section separator. */
const REMOTE_LISTING_BYTE_BUDGET = DIR_ENTRY_LIMIT * (255 + 3) + 1

/**
 * Bound a far-side directory listing before it crosses SSH/Docker while retaining
 * the exact omitted count the Explorer contract renders.
 *
 * The listing is NUL-delimited because a filename may legally hold any byte but
 * `/` and NUL. The previous `ls -1Ap | awk` line protocol split a name containing
 * a newline into phantom rows, `.trim()`med away leading/trailing spaces (so the
 * row named a file that does not exist), let a file literally named `__NOT_DIR__`
 * blank its whole folder, and inherited `ls`'s locale and BSD/GNU differences.
 *
 * Only POSIX-portable pieces are used, so GNU, BSD (macOS) and busybox hosts all
 * answer the same: `find -mindepth/-maxdepth/-print0/-type d` (not GNU-only
 * `-printf`), `tr -cd '\000'` to count records, `head -c` to bound transport.
 * The directory kind comes from running `-type d` and `! -type d` as two passes
 * separated by one EMPTY record — a real record is never empty, since each starts
 * with `./`. `find` does not follow symlinks, so a link to a folder lists as a
 * file, exactly like the local `readdir` branch of {@link listDirectory}.
 *
 * Output: the total entry count on the first line, then the records. Bytes are
 * capped at enough for {@link DIR_ENTRY_LIMIT} records of the longest legal name
 * (NAME_MAX 255 + `./` + NUL); a record cut by the cap has no terminating NUL and
 * is dropped. Which entries of a >1000-entry folder make the cut follows the
 * directory's own order (dirs first) rather than a sorted one — `sort -z` is not
 * portable — and the shown rows are sorted by the caller either way.
 */
export async function listRemoteDirectory(
  env: ExecutionEnvironment,
  target: string,
): Promise<{ entries: DirEntry[]; total: number } | null> {
  const level = '. -mindepth 1 -maxdepth 1'
  const command =
    `command -v find >/dev/null 2>&1 || exit 4; ` +
    `[ -d ${shellQuote(target)} ] && cd -- ${shellQuote(target)} || exit 3; ` +
    `n=$(find ${level} -print0 2>/dev/null | tr -cd '\\000' | wc -c); ` +
    `printf '%s\\n' $n; ` +
    `{ find ${level} -type d -print0; printf '\\000'; find ${level} ! -type d -print0; } 2>/dev/null ` +
    `| head -c ${REMOTE_LISTING_BYTE_BUDGET}`
  const res = await env.exec(command)
  if (res.exitCode !== 0) return null

  const newline = res.stdout.indexOf('\n')
  if (newline < 0) return null
  const counted = Number(res.stdout.slice(0, newline).trim())
  if (!Number.isSafeInteger(counted) || counted < 0) return null

  const records = res.stdout.slice(newline + 1).split('\0')
  // The final piece is '' after a complete stream, or a record the byte cap cut.
  records.pop()
  const entries: DirEntry[] = []
  let type: DirEntry['type'] = 'dir'
  for (const record of records) {
    if (record === '') {
      type = 'file'
      continue
    }
    if (entries.length >= DIR_ENTRY_LIMIT) break
    if (!record.startsWith('./')) return null
    entries.push({ name: record.slice(2), type })
  }
  // The count and the listing are two reads of a live folder; never report fewer
  // entries than were shown.
  return { entries, total: Math.max(counted, entries.length) }
}

export async function listDirectory(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  dirPath?: string,
): Promise<DirListing> {
  const { env, dir: root } = await openSessionEnv(ctx, userId, sessionId)
  const target = !dirPath ? root : resolveAgainst(root, dirPath)

  let unsortedEntries: DirEntry[]
  let totalEntries: number
  if (env.config.kind === 'local') {
    // Explorer refresh is latency-sensitive and can read several expanded folders
    // after one filesystem frame. A local listing must stay in-process: spawning a
    // login shell + `ls` per folder measured 12–91x slower than native readdir and
    // also split legal filenames containing newlines into phantom tree rows.
    try {
      unsortedEntries = (await readdir(target, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? ('dir' as const) : ('file' as const),
      }))
      totalEntries = unsortedEntries.length
    } catch {
      throw new ApiError(404, 'not_a_directory', `${target} is not a directory`)
    }
  } else {
    const remote = await listRemoteDirectory(env, target)
    if (!remote) {
      throw new ApiError(404, 'not_a_directory', `${target} is not a directory`)
    }
    unsortedEntries = remote.entries
    totalEntries = remote.total
  }

  const allEntries = unsortedEntries.sort((a, b) =>
    a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
  )

  // Cap huge directories (e.g. `.turbo/cache`, `node_modules` with tens of
  // thousands of entries) so a single expand can't ship — or make the tree
  // render — an unbounded row list and freeze the UI. Dirs sort first, so the
  // cap keeps the most navigable entries; the omitted count rides `truncated`.
  const overflow = totalEntries - DIR_ENTRY_LIMIT
  const entries = overflow > 0 ? allEntries.slice(0, DIR_ENTRY_LIMIT) : allEntries

  return { path: target, entries, ...(overflow > 0 ? { truncated: overflow } : {}) }
}
