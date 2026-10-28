// `# Memory` — Claude Code's auto memory: one folder per repository, shared with Claude Code
// itself, whose MEMORY.md index rides the prompt and whose topic files the model reads and keeps
// with the ordinary file tools. The folder and its loading are `features/memory/auto-memory.ts`.

import type { RunProfile } from '../../run-shape'
import { TOOL } from '../../tool-names'

/** The run's memory folder and its MEMORY.md as loaded (first 200 lines or 25KB). */
export interface MemoryPromptContext {
  dir: string
  index: string
  /** The index was longer than what loaded. */
  clipped: boolean
}

export function buildMemorySection(memory: MemoryPromptContext): string {
  const index = memory.index.trim()
  return [
    '# Memory',
    `You have a persistent, file-based memory at \`${memory.dir}\`, kept across this project's conversations. Read a file there when it is relevant; save with the file tools.`,
    'Save a memory when you learn something a later conversation needs: who the person is and how they like to work (user), guidance on how you should work, with its why (feedback), ongoing work, goals or constraints the code does not show (project), where outside information lives (reference). Do not save what the code, the git history or the instruction files already record, or what only matters to this conversation.',
    [
      'To save one, write one fact per file, starting with:',
      '```markdown',
      '---',
      'name: <short-kebab-case-slug>',
      'description: <one line, used to decide relevance later>',
      'metadata:',
      '  type: user | feedback | project | reference',
      '---',
      '```',
      'then add a one-line pointer to MEMORY.md: `- [Title](file.md) — hook`. Update an existing file rather than writing a duplicate, and delete one that turns out wrong. A memory reflects when it was written: check that a file or flag it names still exists before relying on it.',
    ].join('\n'),
    index
      ? `## MEMORY.md${memory.clipped ? ' (its first 200 lines or 25KB; keep the index short so all of it loads)' : ''}\n${index}`
      : '## MEMORY.md\nMEMORY.md is empty.',
  ].join('\n\n')
}

/**
 * Whether a run keeps the conversation's memory, as in Claude Code: the conversation's own runs
 * do, with the file tools; a subagent starts without it. A fork is sent its parent's prompt,
 * memory included, so it keeps the folder too (`chat/runtime/run/memory-roots.ts`).
 */
export function runKeepsMemory(profile: RunProfile, hasTool: (name: string) => boolean): boolean {
  return profile.shape !== 'subagent' && hasTool(TOOL.Write) && hasTool(TOOL.Edit)
}
