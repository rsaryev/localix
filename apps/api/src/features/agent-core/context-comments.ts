import { createFenceTracker } from '../../lib/markdown-code'

/**
 * Block-level HTML comments (`<!-- maintainer notes -->`) taken out of an instruction file before
 * it reaches the prompt, as Claude Code does (memory.md, "How CLAUDE.md files load"): notes for
 * the humans who maintain the file cost no context. A comment opens at the start of a line and may
 * run over several; comments inside fenced code blocks, and inline ones within prose, are kept.
 */
export function stripHtmlBlockComments(text: string): string {
  if (!text.includes('<!--')) return text
  const out: string[] = []
  const insideFence = createFenceTracker()
  let inComment = false
  for (const line of text.split('\n')) {
    if (inComment) {
      const end = line.indexOf('-->')
      if (end < 0) continue
      inComment = false
      const rest = line.slice(end + 3)
      if (rest.trim()) out.push(rest)
      continue
    }
    if (insideFence(line)) {
      out.push(line)
      continue
    }
    const open = /^\s*<!--/.exec(line)
    if (!open) {
      out.push(line)
      continue
    }
    const end = line.indexOf('-->', open[0].length)
    if (end < 0) {
      inComment = true
      continue
    }
    const rest = line.slice(end + 3)
    if (rest.trim()) out.push(rest)
  }
  return out.join('\n')
}
