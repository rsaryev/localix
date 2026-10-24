/**
 * A PACKAGE'S IDENTITY (`docs/internals/store-scale.md`, "Identity and duplicates"): its origin,
 * normalized, so two sources that list one package are seen to. A git repository is its host and
 * path without `.git`, whatever the spelling (HTTPS, SSH, GitHub's `owner/repo`), plus the folder
 * inside it and the branch or tag it names; a pinned commit is a version of it, not another
 * package, and `main` or `master` is the repository itself. An npm package is its name; a catalog archive is its catalog name.
 */

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/

function repositoryOf(url: string): string {
  const raw = url.trim()
  if (GITHUB_SHORTHAND.test(raw)) return `github.com/${raw}`.toLowerCase()
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(raw)
  const spelled = scp ? `${scp[1]}/${scp[2]}` : raw.replace(/^[a-z+]+:\/\/(?:[^@/]+@)?/i, '')
  return spelled
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase()
}

const folderOf = (path: string | undefined) =>
  (path ?? '')
    .replace(/^\.\/?/, '')
    .replace(/^\/+|\/+$/g, '')
    .trim()

/** Branches that are almost always the default one: naming them names the repository. */
const DEFAULT_BRANCHES = new Set(['main', 'master', 'HEAD'])

export function gitOrigin(source: { url: string; path?: string; ref?: string }): string {
  const folder = folderOf(source.path)
  const ref = source.ref && !DEFAULT_BRANCHES.has(source.ref) ? `@${source.ref}` : ''
  return `git:${repositoryOf(source.url)}${folder ? `#${folder}` : ''}${ref}`
}

export const npmOrigin = (name: string): string => `npm:${name.trim().toLowerCase()}`

export const catalogOrigin = (name: string): string => `catalog:${name.trim().toLowerCase()}`
