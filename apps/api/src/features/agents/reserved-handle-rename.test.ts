import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_AGENTS } from './builtin'
import { listAgentFiles } from './discovery'
import { RENAMED_HUMAN_AGENT_HANDLE, relocateReservedHandle } from './reserved-handle-rename'

const withDir = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), 'lx-human-agent-'))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const localix = BUILTIN_AGENTS.find((agent) => agent.handle === 'localix')!
const agentNamedHuman = () => ({
  ...localix,
  id: `native:global:${crypto.randomUUID()}`,
  handle: 'human',
})

describe('an agent saved as @human before the person took the handle', () => {
  test('moves once to human-agent.json, with a log line, and keeps loading', async () => {
    await withDir(async (dir) => {
      writeFileSync(join(dir, 'human.json'), JSON.stringify(agentNamedHuman()))
      const warnings: string[] = []
      const original = console.warn
      console.warn = (message: string) => warnings.push(message)
      try {
        const files = await listAgentFiles(dir)
        expect(files.map((file) => file.record.handle)).toEqual([RENAMED_HUMAN_AGENT_HANDLE])
        expect(files[0]!.path).toBe(join(dir, 'human-agent.json'))
      } finally {
        console.warn = original
      }
      expect(existsSync(join(dir, 'human.json'))).toBe(false)
      expect(JSON.parse(readFileSync(join(dir, 'human-agent.json'), 'utf8')).handle).toBe(
        RENAMED_HUMAN_AGENT_HANDLE,
      )
      expect(warnings).toHaveLength(1)
      // A second read finds nothing left to move.
      expect((await listAgentFiles(dir)).map((file) => file.record.handle)).toEqual([
        RENAMED_HUMAN_AGENT_HANDLE,
      ])
      expect(warnings).toHaveLength(1)
    })
  })

  test("the person's own record and other agents are left alone", async () => {
    const human = BUILTIN_AGENTS.find((agent) => agent.kind === 'human')!
    const warn = () => {
      throw new Error('nothing to move')
    }
    for (const record of [human, localix]) {
      const file = { path: '/nowhere/x.json', text: JSON.stringify(record) }
      expect(await relocateReservedHandle(file, warn)).toBe(file)
    }
  })

  test('a taken target name loads the renamed record in place and moves nothing', async () => {
    await withDir(async (dir) => {
      writeFileSync(join(dir, 'human-agent.json'), '{}')
      const file = { path: join(dir, 'human.json'), text: JSON.stringify(agentNamedHuman()) }
      writeFileSync(file.path, file.text)
      const moved = await relocateReservedHandle(file, () => {})
      expect(moved.path).toBe(file.path)
      expect(JSON.parse(moved.text).handle).toBe(RENAMED_HUMAN_AGENT_HANDLE)
      expect(existsSync(file.path)).toBe(true)
    })
  })
})
