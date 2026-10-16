import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { agentRunPreflight, registerAgentRunPreflight } from './agentRunPreflight'

describe('agent run preflight', () => {
  test('exposes one app-owned barrier and removes only its own registration', async () => {
    const scopes: Array<string | null | undefined> = []
    const first = registerAgentRunPreflight((projectId) => {
      scopes.push(projectId)
      return Promise.resolve()
    })
    const second = registerAgentRunPreflight((projectId) => {
      scopes.push(projectId)
      return null
    })

    expect(agentRunPreflight('project-a')).toBeNull()
    first()
    expect(agentRunPreflight(null)).toBeNull()
    second()
    expect(agentRunPreflight(undefined)).toBeNull()
    expect(scopes).toEqual(['project-a', null])
  })

  test('all workbench entry points cross the centralized policy owner', () => {
    const messages = readFileSync(resolve(import.meta.dir, 'client/messages.ts'), 'utf8')
    const runs = readFileSync(resolve(import.meta.dir, 'client/runs.ts'), 'utf8')
    // Three entry points start an agent run from the workbench. It was four while the mode
    // picker could carry a plan-approval continuation; that endpoint is gone with agent modes.
    expect(messages.match(/await readyAgentRunToolSurface\(/g)).toHaveLength(3)
    expect(runs).toMatch(
      /async runSessionLoop[\s\S]*?const policy = agentRunPreflight\(undefined\)[\s\S]*?if \(policy\) await policy/,
    )
  })
})
