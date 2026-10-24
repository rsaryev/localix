import { expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import type { PersistedMessage } from '../../contracts'
import { touchedInstructionsSection } from './touched-instructions'

// memory.md: a subdirectory's CLAUDE.md loads once Claude works with a file there; the run hands
// it to the model then, beside the session's project context.
const dir = tempDirPerTest('touched-instr-')
const read = (path: string): PersistedMessage =>
  ({
    id: 'm',
    sessionId: 's',
    userId: 'u',
    payload: {
      id: 'm',
      role: 'assistant',
      items: [{ type: 'tool_call', toolCallId: 't', name: 'read', input: { path } }],
    },
  }) as never

test('a run lists the instructions of the folders its session worked in', async () => {
  await mkdir(join(dir(), '.git'))
  await mkdir(join(dir(), 'apps', 'web'), { recursive: true })
  await writeFile(join(dir(), 'apps', 'web', 'CLAUDE.md'), 'Use the kit.')
  const home = join(dir(), 'home')
  expect(
    await touchedInstructionsSection({ cwd: dir(), history: [], loaded: [], homeDir: home }),
  ).toBeNull()
  const section = await touchedInstructionsSection({
    cwd: dir(),
    history: [read('apps/web/page.tsx')],
    loaded: [],
    homeDir: home,
  })
  expect(section?.scope).toBe('state')
  expect(section?.text).toContain(join(dir(), 'apps', 'web', 'CLAUDE.md'))
  expect(section?.text).toContain('Use the kit.')
})
