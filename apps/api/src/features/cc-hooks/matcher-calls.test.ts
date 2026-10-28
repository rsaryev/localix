import { describe, expect, it } from 'bun:test'

import { matchesToolName, toolNameCandidates } from './matcher'

// A matcher names one kind of call: a Claude Code name the call does not carry never fires.
describe('the names one call answers to', () => {
  it('every skill call is a Skill call: the tool has one name', () => {
    for (const action of ['get', 'save', 'list', 'delete'])
      expect(matchesToolName('Skill', 'Skill', undefined, { action, name: 'x' })).toBe(true)
  })

  it('Monitor is a bash wait with `until`, never a plain command', () => {
    expect(matchesToolName('Monitor', 'Bash', undefined, { command: 'x', until: 10 })).toBe(true)
    expect(matchesToolName('Bash', 'Bash', undefined, { command: 'x', until: 10 })).toBe(false)
    expect(matchesToolName('Monitor', 'Bash', undefined, { command: 'x' })).toBe(false)
    expect(matchesToolName('Bash', 'Bash', undefined, { command: 'x' })).toBe(true)
  })

  it("a regex matcher sees the tool's one name", () => {
    expect(matchesToolName('^(?!Bash$).*', 'Bash', undefined, { command: 'x' })).toBe(false)
    expect(matchesToolName('^(?!Read$).*', 'Bash', undefined, { command: 'x' })).toBe(true)
    expect(matchesToolName('^Bash$', 'Bash', undefined, { command: 'x' })).toBe(true)
  })

  it('the subagent tools are Claude Code’s own: a regex sees only the name the call carries', () => {
    const calls = {
      Agent: { description: 'd', prompt: 'p' },
      SendMessage: { to: 'sub-1', message: 'm' },
      TaskStop: { task_id: 'sub-1' },
    }
    for (const [tool, input] of Object.entries(calls)) {
      expect(matchesToolName(`^(?!${tool}$).*`, tool, undefined, input)).toBe(false)
      expect(matchesToolName(`^${tool}$`, tool, undefined, input)).toBe(true)
      expect(matchesToolName(tool, tool, undefined, input)).toBe(true)
    }
    // Claude Code's former names still reach them by name.
    expect(matchesToolName('Task', 'Agent', undefined, calls.Agent)).toBe(true)
    expect(matchesToolName('KillShell', 'TaskStop', undefined, calls.TaskStop)).toBe(true)
  })

  it('a tool Claude Code has no name for goes by the name the model calls it', () => {
    const open = { action: 'open', url: 'http://localhost:3000' }
    expect(matchesToolName('Browser', 'Browser', undefined, open)).toBe(true)
    expect(matchesToolName('^Browser$', 'Browser', undefined, open)).toBe(true)
    expect(matchesToolName('^(?!Browser$).*', 'Browser', undefined, open)).toBe(false)
  })

  it('a call Claude Code has no name for goes by the tool’s model name', () => {
    expect(matchesToolName('Loops', 'Loops', undefined, { action: 'update', id: 'x' })).toBe(true)
    expect(matchesToolName('Plan', 'Plan', undefined, { action: 'complete' })).toBe(true)
    expect(matchesToolName('^(?!Plan$).*', 'Plan', undefined, { action: 'complete' })).toBe(false)
  })

  it('a loops call meets only its own Cron name', () => {
    const add = { action: 'add', cron: '* * * * *', prompt: 'p' }
    expect(matchesToolName('CronCreate', 'Loops', undefined, add)).toBe(true)
    expect(matchesToolName('CronDelete', 'Loops', undefined, add)).toBe(false)
    expect(matchesToolName('ScheduleWakeup', 'Loops', undefined, add)).toBe(false)
    expect(matchesToolName('CronList', 'Loops', undefined, { action: 'list' })).toBe(true)
  })

  it('a resource read is not a resource list', () => {
    expect(
      matchesToolName('ReadMcpResourceTool', 'McpResources', undefined, { action: 'list' }),
    ).toBe(false)
    expect(
      matchesToolName('ListMcpResourcesTool', 'McpResources', undefined, { action: 'list' }),
    ).toBe(true)
  })

  it('does not offer the table’s new tool-list names as legacy candidates', () => {
    expect(toolNameCandidates('Plan')).not.toContain('exitplanmode')
    expect(toolNameCandidates('Agent')).not.toContain('sendmessage')
    expect(toolNameCandidates('ToolSearch')).toContain('ToolSearch')
  })
})
