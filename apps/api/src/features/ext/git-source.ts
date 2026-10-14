/**
 * Git-source helpers for the plugin installer (`plugins/service.ts`), kept here
 * because they are generic to any filesystem drop-in and mirror each
 * other file-for-file. Kept here so the install path has one definition.
 */

/** True when `source` looks like a git remote (http(s)/git@/ssh) or `owner/repo` shorthand. */
export function isGitSource(source: string): boolean {
  return (
    /^https?:\/\//.test(source) ||
    source.startsWith('git@') ||
    source.startsWith('ssh://') ||
    /^[\w.-]+\/[\w.-]+$/.test(source) // owner/repo shorthand
  )
}

/** Normalize an `owner/repo` shorthand to a GitHub https URL; pass other sources through. */
export function gitUrl(source: string): string {
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) return `https://github.com/${source}.git`
  return source
}
