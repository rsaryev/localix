import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { AgentTool } from '@localixai/agent/agents'
import { tempDirPerTest } from '@localixai/testing'

import { createPermissionGate, type PermissionRule } from '../../../agent-core/permission-engine'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import { memoryRoots } from './memory-roots'

/**
 * A run keeps its memory as Claude Code does, with the file tools and no card: the folder lives
 * outside the project (`~/.claude/projects/<project>/memory`), where every other write still
 * asks. A subagent keeps no project memory; an agent file's own `memory` folder is its to keep.
 */
const scratch = tempDirPerTest('memory-roots-')

const OUTSIDE_ASKS: PermissionRule[] = [
  { permission: '*', pattern: '*', action: 'allow' },
  { permission: '*', pattern: 'outside-workspace', action: 'ask' },
]
const write = { name: 'Write', classify: () => ({ effect: 'files' }) } as unknown as AgentTool
const has = (name: string) => name === 'Write' || name === 'Edit'

function gateWith(extraRoots: string[], project: string) {
  const asked: string[] = []
  let current = ''
  const gate = createPermissionGate({
    rules: OUTSIDE_ASKS,
    toolsByName: new Map([['write', write]]),
    root: project,
    extraRoots,
    requestConfirm: async () => {
      asked.push(current)
      return { approved: true }
    },
  })
  const writeTo = (path: string) => {
    current = path
    return gate({ toolCallId: 'c', toolName: 'Write', input: { path, content: 'x' } })
  }
  return { writeTo, asked }
}

describe('where a run keeps memory without asking', () => {
  test("a chat writes its own memory folder freely, and another project's only with a card", async () => {
    const home = scratch()
    const project = join(home, 'repo')
    const mine = join(home, '.claude', 'projects', '-repo', 'memory')
    const theirs = join(home, '.claude', 'projects', '-other', 'memory')
    const roots = memoryRoots({
      profile: resolveRunProfile({ sessionKind: 'chat' }),
      memoryDir: mine,
      hasTool: has,
    })
    const { writeTo, asked } = gateWith(roots, project)

    await writeTo(join(mine, 'user-role.md'))
    await writeTo(join(mine, 'MEMORY.md'))
    expect(asked).toEqual([])
    await writeTo(join(theirs, 'MEMORY.md'))
    await writeTo(join(home, '.claude', 'settings.json'))
    expect(asked).toEqual([join(theirs, 'MEMORY.md'), join(home, '.claude', 'settings.json')])
  })

  test("a subagent asks before touching the project's memory, a fork does not, and an agent file's own is kept", () => {
    const subagent = resolveRunProfile({ sessionKind: 'subagent' })
    const agentDir = '/home/u/.claude/agent-memory/reviewer'
    expect(memoryRoots({ profile: subagent, memoryDir: '/m', hasTool: has })).toEqual([])
    // A fork was sent its parent's prompt, memory included, and keeps it as its parent does.
    expect(memoryRoots({ profile: subagent, memoryDir: '/m', hasTool: has, fork: true })).toEqual([
      '/m',
    ])
    expect(
      memoryRoots({ profile: subagent, memoryDir: '/m', hasTool: has, agentMemoryDir: agentDir }),
    ).toEqual([agentDir])
  })
})
