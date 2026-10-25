import { describe, expect, it } from 'bun:test'

import type { SessionRecord } from '../../repository'
import { ccPermissionMode, ccSessionEnvFilesOf, ccSubagentOf } from './cc-hook-session-facts'

const session = (provenance: SessionRecord['provenance']) =>
  ({ id: 'child-1', rootSessionId: 'root-1', provenance }) as SessionRecord

describe('cc hook session facts', () => {
  it('spells the permission mode as Claude Code does', () => {
    expect(ccPermissionMode('default')).toBe('default')
    expect(ccPermissionMode('plan')).toBe('plan')
    expect(ccPermissionMode('bypass')).toBe('bypassPermissions')
    expect(ccPermissionMode('autonomous')).toBe('bypassPermissions')
  })

  it('names a delegated child by its id and the type SubagentStart reported', () => {
    const delegated = {
      kind: 'task-delegation',
      parentSessionId: 'root-1',
      toolCallId: 't',
      priority: 'normal',
    } as const
    expect(ccSubagentOf(session(delegated))).toEqual({
      id: 'child-1',
      type: 'general-purpose',
    })
    expect(ccSubagentOf(session({ ...delegated, agentType: 'p:helper' }))).toEqual({
      id: 'child-1',
      type: 'p:helper',
    })
    expect(ccSubagentOf(session({ kind: 'unknown-origin' }))).toBeUndefined()
  })

  it('keeps the env files with the root session, so a child sources what it exported', () => {
    const child = ccSessionEnvFilesOf(session({ kind: 'unknown-origin' }))
    const root = ccSessionEnvFilesOf({ id: 'root-1', rootSessionId: null })
    expect(child).toEqual(root)
    expect(root.sessionStart).not.toBe(root.cwd)
  })
})
