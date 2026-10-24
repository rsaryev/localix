import type { ContextFile } from '../../../agent-core/context-files'
import { discoverTouchedContextFiles } from '../../../agent-core/context-on-demand'
import type { RuntimeSection } from '../../../agent-core/prompt/runtime-sections'
import type { PersistedMessage } from '../../contracts'
import { touchedFilesOf } from '../touched-files'

/**
 * `# Instructions for the files in use` — the instruction files and path-scoped rules that the
 * session's work has reached (`agent-core/context-on-demand.ts`), as Claude Code loads them when
 * Claude works with a file there. A `state` section: it is re-sent only when the list changes, and
 * the cached project context above it stays byte-stable.
 */
export async function touchedInstructionsSection(input: {
  cwd: string
  history: readonly PersistedMessage[]
  loaded: readonly ContextFile[]
  homeDir?: string
}): Promise<RuntimeSection | null> {
  const touched = touchedFilesOf(input.history, input.cwd)
  if (touched.length === 0) return null
  const files = await discoverTouchedContextFiles(
    input.cwd,
    touched,
    input.loaded,
    input.homeDir ? { homeDir: input.homeDir } : {},
  )
  if (files.length === 0) return null
  return {
    key: 'context-files:touched',
    scope: 'state',
    text: [
      '# Instructions for the files in use',
      'Project-provided instructions for the folders and files this session has worked with. Follow them there; if they conflict with user instructions, the user wins.',
      '',
      ...files.map((f) => `## ${f.path}\n${f.content}`),
    ].join('\n'),
  }
}
