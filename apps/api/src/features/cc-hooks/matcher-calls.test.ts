import { describe, expect, it } from 'bun:test'

import { matchesToolName, toolNameCandidates } from './matcher'

// A matcher names one kind of call: a Claude Code name the call does not carry never fires.
describe('the names one call answers to', () => {
  it('Skill is a skill `get`; save, list and delete are not Skill calls', () => {
    expect(matchesToolName('Skill', 'skill', undefined, { action: 'get', name: 'x' })).toBe(true)
    for (const action of ['save', 'list', 'delete'])
      expect(matchesToolName('Skill', 'skill', undefined, { action, name: 'x' })).toBe(false)
    // The Localix-only calls are still matched by the tool's own name.
    expect(matchesToolName('skill', 'skill', undefined, { action: 'save' })).toBe(true)
  })

  it('Monitor is a bash wait with `until`, never a plain command', () => {
    expect(matchesToolName('Monitor', 'bash', undefined, { command: 'x', until: 10 })).toBe(true)
    expect(matchesToolName('Bash', 'bash', undefined, { command: 'x', until: 10 })).toBe(false)
    expect(matchesToolName('Monitor', 'bash', undefined, { command: 'x' })).toBe(false)
    expect(matchesToolName('Bash', 'bash', undefined, { command: 'x' })).toBe(true)
  })

  it('a loops call meets only its own Cron name', () => {
    const add = { action: 'add', cron: '* * * * *', prompt: 'p' }
    expect(matchesToolName('CronCreate', 'loops', undefined, add)).toBe(true)
    expect(matchesToolName('CronDelete', 'loops', undefined, add)).toBe(false)
    expect(matchesToolName('ScheduleWakeup', 'loops', undefined, add)).toBe(false)
    expect(matchesToolName('CronList', 'loops', undefined, { action: 'list' })).toBe(true)
  })

  it('a resource read is not a resource list', () => {
    expect(
      matchesToolName('ReadMcpResourceTool', 'mcp_resources', undefined, { action: 'list' }),
    ).toBe(false)
    expect(
      matchesToolName('ListMcpResourcesTool', 'mcp_resources', undefined, { action: 'list' }),
    ).toBe(true)
  })

  it('does not offer the table’s new tool-list names as legacy candidates', () => {
    expect(toolNameCandidates('plan')).not.toContain('exitplanmode')
    expect(toolNameCandidates('delegate')).not.toContain('sendmessage')
    expect(toolNameCandidates('activate_tools')).toContain('ToolSearch')
  })
})
