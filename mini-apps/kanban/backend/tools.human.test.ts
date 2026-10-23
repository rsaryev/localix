import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { PluginContext } from '@localixai/mini-app-sdk/backend'

import { register } from './index'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Result = { content: string; isError?: boolean }
const LEADER = { agentId: 'a:lead', handle: 'lead', role: 'leader' }

function board() {
  const root = mkdtempSync(join(tmpdir(), 'kanban-human-'))
  roots.push(root)
  const told: Array<{ sessionId: string; key: string; text: string }> = []
  const ctx = {
    userId: 'u1',
    z,
    sessionStorage: { resolveDataDir: async (_u: string, s: string) => join(root, s) },
    agents: {
      list: async () => [
        { id: 'a:lead', handle: 'lead' },
        { id: 'user', handle: 'human', kind: 'human', description: 'Manual QA' },
      ],
      notifyHuman: async (_u: string, sessionId: string, notice: { key: string; text: string }) => {
        told.push({ sessionId, ...notice })
      },
    },
    defineTool: (definition: unknown) => definition,
    ui: { offer: (destination: object) => ({ type: 'ui.navigate', ...destination }) },
  } as unknown as PluginContext
  const kanban = (register(ctx).tools ?? []).find((candidate) => candidate.name === 'kanban')!
  const act = (input: object) =>
    kanban.execute('call-1', input as never, undefined, undefined, {
      session: { id: 's1', speaker: LEADER },
    } as never) as Promise<Result>
  return { act, told }
}

test('a card assigned to @human tells the person and cannot be taken or completed', async () => {
  const { act, told } = board()
  await act({
    action: 'create',
    creates: [{ title: 'Verify the release by hand', agent: 'human' }],
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(told).toEqual([
    {
      sessionId: 's1',
      key: 'kanban:LX-1',
      text: 'LX-1 is assigned to you: Verify the release by hand',
    },
  ])
  for (const action of ['take', 'complete']) {
    const refused = await act({ action, task_id: 'LX-1' })
    expect(refused.isError).toBe(true)
    expect(refused.content).toBe('LX-1 is for @human; it waits for the person.')
  }
})

test('reassigning a card to @human tells the person once', async () => {
  const { act, told } = board()
  await act({ action: 'create', creates: [{ title: 'Pick the copy', agent: 'lead' }] })
  await act({ action: 'update', task_id: 'LX-1', agent: 'human' })
  await act({ action: 'update', task_id: 'LX-1', agent: 'human' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(told.map((notice) => notice.key)).toEqual(['kanban:LX-1'])
})
