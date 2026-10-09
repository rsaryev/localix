import { rankPaths } from './fuzzy-rank'
import type { FileSearchEntry, FileSearchResult, FileSearchType } from '../contracts'

/** Options for project file-name search. */
export interface FindFilesOptions {
  /** Match mode. `fuzzy` (default) ranks subsequence matches; `regex` filters by
   *  a JS regular expression over the path (a malformed pattern → no results). A
   *  query prefixed with `/` is treated as `regex` regardless of `mode`. */
  mode?: 'fuzzy' | 'regex'
  /** Which entry kinds to surface. `folders` derives unique directories from the
   *  file list (ripgrep only emits files). */
  type?: FileSearchType
  /** Restrict to these extensions (without the dot, case-insensitive). */
  extensions?: string[]
  /** Page size (default 40). */
  limit?: number
  /** Page offset into the ranked matches (default 0). */
  offset?: number
  /** Include files a parent repo's `.gitignore` hides (container-of-clones —
   *  see project-file-index.ts). Default false = respect .gitignore. */
  includeIgnored?: boolean
}

/** Unique parent directories of a set of project-relative file paths. */
export function deriveFolders(files: string[]): string[] {
  const dirs = new Set<string>()
  for (const f of files) {
    let slash = f.lastIndexOf('/')
    while (slash > 0) {
      dirs.add(f.slice(0, slash))
      slash = f.lastIndexOf('/', slash - 1)
    }
  }
  return [...dirs]
}

/**
 * Pure filter/rank/paginate over a project-relative file list (the result of
 * `rg --files`). Used by file-search.ts so the search semantics are
 * unit-testable without spinning up an execution environment.
 */
export function searchPaths(
  allFiles: string[],
  query: string,
  opts: FindFilesOptions = {},
): Omit<FileSearchResult, 'root'> {
  const limit = opts.limit ?? 40
  const offset = opts.offset ?? 0
  const wantType = opts.type ?? 'all'

  // Extension filter (applies to files; folders are derived after).
  const exts = (opts.extensions ?? [])
    .map((e) => e.replace(/^\./, '').toLowerCase())
    .filter(Boolean)
  const filePool =
    exts.length === 0
      ? allFiles
      : allFiles.filter((f) => {
          const dot = f.lastIndexOf('.')
          const ext = dot >= 0 ? f.slice(dot + 1).toLowerCase() : ''
          return exts.includes(ext)
        })

  // Choose the candidate pool by requested type.
  const filePaths = new Set(filePool)
  const candidates =
    wantType === 'folders'
      ? deriveFolders(filePool)
      : wantType === 'files'
        ? filePool
        : [...filePool, ...deriveFolders(filePool)]

  // `/pattern` always means regex; otherwise honour the explicit mode.
  const isRegex = query.startsWith('/') || opts.mode === 'regex'
  const rawQuery = query.startsWith('/') ? query.slice(1) : query

  let ranked: string[]
  if (isRegex) {
    let re: RegExp | null = null
    try {
      re = new RegExp(rawQuery, 'i')
    } catch {
      return { files: [], count: 0 }
    }
    ranked = candidates.filter((p) => re!.test(p)).sort((a, b) => a.length - b.length)
  } else {
    ranked = rankPaths(candidates, rawQuery)
  }

  const page = ranked.slice(offset, offset + limit)
  const files: FileSearchEntry[] = page.map((p) => ({
    path: p,
    name: p.slice(p.lastIndexOf('/') + 1),
    type: filePaths.has(p) ? 'file' : 'dir',
  }))

  return { files, count: ranked.length }
}
