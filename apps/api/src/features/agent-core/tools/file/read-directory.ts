import { shellQuote, type ExecutionEnvironment } from '../environment'
import { MAX_DIR_ENTRIES } from './read-output'

/**
 * If `targetPath` is a directory, return a sorted listing (one entry per line,
 * directories suffixed with `/`); otherwise return null. Uses env.exec so it works
 * identically across local / ssh / docker backends.
 */
export async function tryListDirectory(
  env: ExecutionEnvironment,
  targetPath: string,
): Promise<string | null> {
  const q = shellQuote(targetPath)
  // -1: one per line, -A: almost-all (skip . and ..), -p: append / to directories.
  // Stop at one sentinel beyond the display cap. Letting `ls` finish first made
  // the shared exec capture keep an arbitrary tail past 4 MB, then this function
  // sorted that tail and reported its length as the directory's exact count.
  const cmd = `if [ -d ${q} ]; then ls -1Ap -- ${q} | head -n ${MAX_DIR_ENTRIES + 1}; else printf '__NOT_A_DIR__'; fi`
  let result: { stdout: string; stderr: string; exitCode: number }
  try {
    // `uncapped` is safe here because `head` has already bounded the producer to
    // 1,001 filesystem names (each component is itself filesystem-size-bounded).
    result = await env.exec(cmd, { uncapped: true })
  } catch {
    return null
  }
  // `head` owns the pipeline exit code, so stderr is the remaining `ls` failure signal.
  if (result.exitCode !== 0 || result.stderr.trim() || result.stdout.includes('__NOT_A_DIR__'))
    return null
  const entries = result.stdout
    .split('\n')
    .map((s) => s.trim())
    // The workspace's own `.localix/` is the host's cache, not the user's project.
    .filter((s) => s && s !== '.localix/')
    .sort()
  const sourceTruncated = entries.length > MAX_DIR_ENTRIES
  const shown = sourceTruncated ? entries.slice(0, MAX_DIR_ENTRIES) : entries
  if (sourceTruncated) {
    return `Directory ${targetPath} — more than ${MAX_DIR_ENTRIES} entries (showing first ${MAX_DIR_ENTRIES}):\n${shown.join('\n')}\n[…more entries omitted]`
  }
  return `Directory ${targetPath} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}:\n${shown.join('\n')}`
}
