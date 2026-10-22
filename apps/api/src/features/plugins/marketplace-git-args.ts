/**
 * What a marketplace may hand to `git`. A catalog is someone else's file, so its URLs and refs
 * become git arguments only in the forms Claude Code documents for a git source — `https://`,
 * `http://`, `ssh://`, `file://` and scp-style `user@host:path` — and never as something git
 * would read as an option (a leading `-`) or a remote-helper transport (`ext::<command>`, which
 * runs a command, or any other `<helper>::<address>`).
 */

const URL_SCHEME = /^(?:https?|ssh|file):\/\/[^\s]+$/i
/** scp-like SSH: `user@host:path`, where user and host cannot start with `-`. */
const SCP_LIKE = /^[\w.~][\w.~-]*@[\w.][\w.-]*:[^\s]+$/

/** Why `url` may not be passed to git, or null when it may. */
export function gitUrlProblem(url: string): string | null {
  if (url.startsWith('-')) return `git URL "${url}" starts with "-"`
  // oxlint-disable-next-line no-control-regex -- control characters are what this refuses
  if (/[\0-\x1f\x7f]/.test(url)) return `git URL "${url}" contains a control character`
  if (/^[\w+.-]*::/.test(url)) return `git URL "${url}" names a remote helper transport ("::")`
  if (URL_SCHEME.test(url) || SCP_LIKE.test(url)) return null
  return `git URL "${url}" must be https://, http://, ssh://, file:// or git@host:path`
}

/** Why `ref` may not be passed to git as a branch, tag or commit, or null when it may. */
export function gitRefProblem(ref: string): string | null {
  if (ref.startsWith('-')) return `git ref "${ref}" starts with "-"`
  if (/[\0-\x20\x7f~^:?*[\\]/.test(ref) || ref.includes('..'))
    return `git ref "${ref}" is not a valid branch, tag or commit`
  return null
}

/** Throw when the git coordinates of a marketplace or plugin source are unsafe to run. */
export function assertGitArgs(what: string, url: string, ref?: string): void {
  const problem = gitUrlProblem(url) ?? (ref === undefined ? null : gitRefProblem(ref))
  if (problem) throw new Error(`${what}: ${problem}`)
}
