import { describe, expect, it } from 'bun:test'

import {
  CC_ALWAYS_ON_TOOLS,
  CC_SEMANTIC_GAPS,
  CC_TOOL_NAME_MAP,
  mapCcRuleList,
  mapCcToolList,
  splitDenyList,
} from './cc-tool-names'
import { claudeCodeNames } from './cc-tool-shapes'
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'

// One table: the names a hook sees a call under are the names an agent, skill or command may
// list in `tools` / `disallowedTools`.
describe('the tool-list name table', () => {
  const list = (...names: string[]) => mapCcToolList(names, { dropUnknown: true })

  it('resolves every Claude Code name a hook can see a Localix call under', () => {
    expect(list('ExitPlanMode')).toEqual(['plan'])
    expect(list('SendMessage')).toEqual(['delegate'])
    expect(list('TaskStop')).toEqual(['jobs'])
    expect(list('ToolSearch')).toEqual(['activate_tools'])
    expect(list('Workflow')).toEqual(['workflow'])
    expect(list('CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup')).toEqual(['loops'])
    expect(list('ListMcpResourcesTool', 'ReadMcpResourceTool')).toEqual(['mcp_resources'])
    expect(list('Monitor')).toEqual(['bash'])
  })

  it('has an entry for every per-call name of every shaped tool', () => {
    for (const local of [
      'bash',
      'read',
      'edit',
      'write',
      'search',
      'research',
      'jobs',
      'delegate',
      'skill',
      'ask',
      'plan',
      'activate_tools',
      'workflow',
      'loops',
      'mcp_resources',
    ])
      for (const name of claudeCodeNames(local)) expect(list(name).length).toBe(1)
    for (const name of claudeCodeNames('loops')) expect(list(name)).toEqual(['loops'])
    for (const name of claudeCodeNames('delegate')) expect(list(name).length).toBe(1)
  })

  it('takes a Localix tool by its own name as well', () => {
    expect(list('browser', 'plan', 'jobs', 'memory')).toEqual(['browser', 'plan', 'jobs', 'memory'])
  })

  it('leaves the old gaps unmapped and still drops what has no tool here', () => {
    expect(list('TodoWrite', 'EnterPlanMode', 'LSP', 'EnterWorktree', 'PushNotification')).toEqual(
      [],
    )
  })

  it('names the always-on infrastructure and keeps it out of the switch-off set', () => {
    expect(CC_ALWAYS_ON_TOOLS).toContain('activate_tools')
    expect(CC_ALWAYS_ON_TOOLS).toContain('tool_output')
    const off = new Set(Object.values(CC_TOOL_NAME_MAP))
    for (const name of CC_ALWAYS_ON_TOOLS) expect(off.has(name)).toBe(false)
    // Localix-only tools are switched off by a `tools` list, as Claude Code's exact list does.
    for (const name of ['plan', 'loops', 'workflow', 'jobs', 'browser', 'mcp_resources'])
      expect(off.has(name)).toBe(true)
    for (const name of BUILTIN_TOOL_NAMES)
      expect(off.has(name) || CC_ALWAYS_ON_TOOLS.includes(name)).toBe(true)
  })

  it('documents the remaining gaps', () => {
    for (const name of [
      'todowrite',
      'taskcreate',
      'enterplanmode',
      'lsp',
      'enterworktree',
      'exitworktree',
      'pushnotification',
      'grep',
      'webfetch',
      'sendmessage',
      'taskstop',
      'monitor',
    ])
      expect(CC_SEMANTIC_GAPS[name]).toBeString()
  })
})

describe('a denylist with specifiers', () => {
  it('keeps Tool(specifier) entries in engine form beside whole-tool entries', () => {
    expect(mapCcRuleList(['Bash(rm *)', 'Read(.env)', 'Write', 'TodoWrite'])).toEqual([
      'bash(rm *)',
      'read(.env)',
      'write',
    ])
    expect(mapCcRuleList(['"Bash(git push:*)"', 'Bash(git push:*)'])).toEqual(['bash(git push:*)'])
  })

  it('splits whole-tool entries, which switch a tool off, from pattern entries, which only deny', () => {
    expect(splitDenyList(['bash(rm *)', 'write', 'read(*)', 'Grep'])).toEqual({
      tools: ['write', 'read', 'search'],
      patterned: ['bash(rm *)'],
    })
  })
})
