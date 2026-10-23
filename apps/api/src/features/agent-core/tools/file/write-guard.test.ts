import { describe, expect, mock, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentTool } from '@localixai/agent/agents'
import { tempDirPerTest } from '@localixai/testing'
import { createPermissionGate } from '../../permission-engine'
import { builtinAgentPreset } from '../../../capabilities/builtin-agent-presets'
import { composeCapabilities, NO_ROSTERS, projectCapabilities } from '../../../capabilities/resolve'
import { createWriteTool, type WriteToolInput } from './write'

/**
 * The write tool's blind-overwrite guard runs BEFORE the permission gate (the engine loop's
 * `admitParsed` calls `tool.guard`, then `beforeToolCall`, and settles the call on a guard
 * block). So the guard must never hand back the content of a file the gate has not judged:
 * otherwise a write naming a file outside the workspace reads it with no confirmation at all.
 */
const dir = tempDirPerTest('write-guard')

/** The shipped role's rules, so the outside-workspace `ask` is the real one. */
const rules = projectCapabilities(
  composeCapabilities(builtinAgentPreset('localix')),
  NO_ROSTERS,
).permissions

/** The loop's admission order (`packages/engine-loop/src/tools/call.ts` `admitParsed`). */
async function admit(tool: AgentTool<WriteToolInput>, root: string, input: WriteToolInput) {
  const requestConfirm = mock(async () => false)
  const gate = createPermissionGate({
    rules,
    toolsByName: new Map([['write', tool as unknown as AgentTool]]),
    root,
    requestConfirm,
  })
  const guard = await tool.guard?.({ toolCallId: 'c1', input })
  if (guard?.block) return { result: guard.result, requestConfirm, settledBy: 'guard' as const }
  const verdict = await gate({ toolCallId: 'c1', toolName: 'write', input })
  return { result: verdict, requestConfirm, settledBy: 'gate' as const }
}

describe('blind-overwrite guard before the permission gate', () => {
  test('never returns the content of an unread file outside the workspace', async () => {
    const workspace = path.join(dir(), 'workspace')
    const outside = path.join(dir(), 'outside')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
    const secret = path.join(outside, 'id_rsa')
    await writeFile(secret, 'DUMMY-PRIVATE-KEY\n', 'utf8')
    const tool = createWriteTool(undefined, workspace)

    const { result } = await admit(tool, workspace, {
      files: [{ path: secret, content: 'x' }],
    })

    expect(JSON.stringify(result)).not.toContain('DUMMY-PRIVATE-KEY')
    expect(await readFile(secret, 'utf8')).toBe('DUMMY-PRIVATE-KEY\n')
  })

  test('the refusal records nothing as read, so a re-issued call is refused again', async () => {
    const workspace = path.join(dir(), 'workspace')
    const outside = path.join(dir(), 'outside')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
    const secret = path.join(outside, 'id_rsa')
    await writeFile(secret, 'DUMMY-PRIVATE-KEY\n', 'utf8')
    const tool = createWriteTool(undefined, workspace)
    const input = { files: [{ path: secret, content: 'x' }] }

    const first = await admit(tool, workspace, input)
    expect(first.settledBy).toBe('guard')
    // Nothing was recorded as read, so the same call is refused again without content.
    const second = await admit(tool, workspace, input)
    expect(second.settledBy).toBe('guard')
    expect(JSON.stringify(second.result)).not.toContain('DUMMY-PRIVATE-KEY')
  })
})
