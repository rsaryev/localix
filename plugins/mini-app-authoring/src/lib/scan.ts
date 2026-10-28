import path from 'node:path'

import { stripComments } from './strip-comments'

export interface SourceFile {
  /** Path relative to the scan root, `/`-separated. */
  file: string
  abs: string
  raw: string
  /** `raw` without comments: what a check reads. */
  code: string
}

/** Every file under `root` matching `include`, comment-stripped; build output and dependencies skipped. */
export async function scanSources(opts: {
  root: string
  include: string[]
  skip?: (file: string) => boolean
}): Promise<SourceFile[]> {
  const seen = new Set<string>()
  const files: SourceFile[] = []
  for (const pattern of opts.include) {
    for await (const rel of new Bun.Glob(pattern).scan(opts.root)) {
      const file = rel.split(path.sep).join('/')
      if (file.includes('node_modules/') || file.startsWith('dist/') || file.includes('/dist/')) {
        continue
      }
      if (opts.skip?.(file) || seen.has(file)) continue
      seen.add(file)
      const abs = path.join(opts.root, rel)
      const raw = await Bun.file(abs).text()
      files.push({ file, abs, raw, code: stripComments(raw) })
    }
  }
  return files
}

/** The 1-based line of `index` in `code`. */
export function lineAt(code: string, index: number): number {
  return code.slice(0, index).split('\n').length
}
