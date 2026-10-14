import { docPages } from '../../generated/docs'

const SLUG_SET = new Set(docPages.map((p) => p.slug))
/** Resolve a relative href to a repo-root-relative path (handles ../, ./,
 *  docs/, leading /), relative to the page it appears on. */
export function resolveRepoPath(href: string, currentSourcePath: string): string {
  const clean = href.split('#')[0].split('?')[0]
  if (clean.startsWith('/')) return clean.replace(/^\/+/, '')
  if (clean.startsWith('docs/')) return clean
  const stack = currentSourcePath.split('/').slice(0, -1)
  for (const part of clean.split('/')) {
    if (part === '..') stack.pop()
    else if (part !== '.') stack.push(part)
  }
  return stack.join('/')
}

/** A repo path → generated doc slug, or null if it isn't a known doc page. */
export function pathToSlug(repoPath: string): string | null {
  if (!repoPath.endsWith('.md')) return null
  const slug = repoPath
    .replace(/^docs\//, '')
    .replace(/\.md$/, '')
    .replace(/\//g, '--')
  return SLUG_SET.has(slug) ? slug : null
}
