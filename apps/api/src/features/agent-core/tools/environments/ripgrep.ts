import type { SearchFilesOptions } from '../environment'
import { shellQuote } from '../environment'

/**
 * THE ripgrep argument vector for `searchFiles` — the SINGLE source of truth for every
 * execution backend. The local backend spawns these tokens as argv; the ssh/docker
 * backends render the SAME tokens into a shell string via {@link buildRipgrepCommand}.
 *
 * It exists because the two drifted: `remote.ts` hand-rolled its own flag string whose
 * comment claimed it "mirrors local searchFiles' flag set" while omitting `--multiline`,
 * so an identical search that worked locally HARD-ERRORED (rg exit 2) on ssh/docker.
 * One builder, two renderings — a flag added here reaches every backend by construction,
 * and a divergence is no longer expressible.
 *
 * rg flags are order-insensitive, so the ORDER here is for readability only; what matters
 * is that both backends emit the same SET. Quoting is purely a rendering concern of the
 * shell form (see buildRipgrepCommand) and never changes the tokens rg receives.
 *
 * Lives beside the backends (not in `environment.ts`) because it is an implementation
 * detail SHARED BY the backend impls, not part of the `ExecutionEnvironment` contract.
 */
/** Excludes the workspace-local `.localix/` tree — the host's cache, not the user's project. */
export const LOCALIX_EXCLUDE_GLOB = '!.localix/**'

export function buildRipgrepArgs(pattern: string, opts?: SearchFilesOptions): string[] {
  // --max-columns caps the DISPLAY width of a matched line (preview keeps the leading
  // chars + a "[… N more]" notice) so a single minified/lock-file/data line can't swallow
  // the whole result budget and bury real matches. Match count, paths, and line numbers
  // are unaffected.
  const args = [
    '--line-number',
    '--with-filename',
    '--color',
    'never',
    '--max-columns',
    '400',
    '--max-columns-preview',
  ]
  // rg hard-errors on `\n` in a pattern unless multiline mode is on. Models routinely write
  // multi-line regexes — enable the flag for them instead of failing the call (a recurring
  // tool-error → bash-fallback source). This MUST apply on every backend: a remote search
  // that rejects a pattern the local one accepts is the same bug wearing a different hat.
  if (opts?.multiline) args.push('--multiline', '--multiline-dotall')
  else if (pattern.includes('\n') || pattern.includes('\\n')) args.push('--multiline')
  if (opts?.ignoreCase) args.push('--ignore-case')
  // `--type=<name>` is one token, so a name can never be read as a flag.
  if (opts?.type) args.push(`--type=${opts.type}`)
  // `-C n` prints n lines around each hit, so the model can judge a match without reading
  // the whole file (ripgrep marks context lines `path-line-text`).
  if (opts?.context && opts.context > 0) args.push('--context', String(opts.context))
  if (opts?.glob) args.push('--glob', opts.glob)
  // The workspace's own `.localix/` (plugin cache, agent data) is never what a search is for.
  args.push('--glob', LOCALIX_EXCLUDE_GLOB)
  // `-e`, NEVER the bare pattern. A positional argument that starts with a dash is a FLAG to
  // rg, so searching for `--color-|--token` died with `unrecognized flag --color-|--token`
  // — and the model, told its search was malformed, went to `bash grep` instead,
  // which is the fallback this tool exists to prevent. CSS custom properties, CLI flags and
  // diff markers all begin with a dash, so this is an ordinary thing to look for rather than
  // an edge case. `-e` says "the next token is a pattern" in any position.
  args.push('-e', pattern, '.')
  return args
}

/**
 * The same invocation as ONE shell-command string, for backends that run rg through
 * `bash -c` (ssh/docker) rather than spawning it directly. Every token — flags included —
 * is single-quoted: the shell strips the quotes, so rg receives byte-identical arguments
 * to the local argv, and a pattern containing spaces, quotes, or newlines survives intact.
 */
export function buildRipgrepCommand(
  pattern: string,
  cwd: string,
  opts?: SearchFilesOptions,
): string {
  const args = buildRipgrepArgs(pattern, opts).map(shellQuote).join(' ')
  return `cd ${shellQuote(cwd)} && rg ${args}`
}
