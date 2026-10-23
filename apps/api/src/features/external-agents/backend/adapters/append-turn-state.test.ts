import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { claudeCodeAdapter } from './claude-code'
import { codexAdapter } from './codex'
import { githubCopilotAdapter } from './github-copilot'
import type { SourceRef } from './types'

const dir = tempDirPerTest('localix-append-turn-')

/** The three formats that append read their turn off the file's last records, the same way. */
const APPENDING = [claudeCodeAdapter, codexAdapter, githubCopilotAdapter]

function ref(lines: unknown[], updatedAtHint: number): SourceRef {
  const sourcePath = join(dir(), 'session.jsonl')
  writeFileSync(sourcePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return { nativeSessionId: 's', sourcePath, revision: 'r', updatedAtHint } as SourceRef
}

describe('reading the turn of an appending session file', () => {
  test('a terminator as the last record reads as idle', async () => {
    const now = Date.now()
    for (const adapter of APPENDING) {
      const source = ref([{ type: 'event_msg', payload: { type: 'task_complete' } }], now)
      expect(await adapter.readTurnState!(source, {} as never, now)).toBe('idle')
    }
  })

  test('nothing recognisable gives no answer', async () => {
    const now = Date.now()
    for (const adapter of APPENDING) {
      const source = ref([{ note: 'summary' }], now)
      expect(await adapter.readTurnState!(source, {} as never, now)).toBeUndefined()
    }
  })
})
