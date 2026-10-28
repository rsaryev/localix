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
    expect(list('ExitPlanMode')).toEqual(['Plan'])
    expect(list('SendMessage')).toEqual(['SendMessage'])
    expect(list('TaskStop', 'KillShell')).toEqual(['TaskStop'])
    expect(list('ToolSearch')).toEqual(['ToolSearch'])
    expect(list('Workflow')).toEqual(['Workflow'])
    expect(list('CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup')).toEqual(['Loops'])
    expect(list('ListMcpResourcesTool', 'ReadMcpResourceTool')).toEqual(['McpResources'])
    expect(list('Monitor')).toEqual(['Bash'])
  })

  it('has an entry for every per-call name of every shaped tool', () => {
    for (const local of [
      'Bash',
      'Read',
      'Edit',
      'Write',
      'Search',
      'Research',
      'Skill',
      'ask',
      'Plan',
      'ToolSearch',
      'Workflow',
      'Loops',
      'McpResources',
    ])
      for (const name of claudeCodeNames(local)) expect(list(name).length).toBe(1)
    for (const name of claudeCodeNames('Loops')) expect(list(name)).toEqual(['Loops'])
  })

  it('takes a Localix tool by its own name as well', () => {
    expect(list('Browser', 'Plan', 'Jobs', 'Skill')).toEqual(['Browser', 'Plan', 'Jobs', 'Skill'])
  })

  it('leaves the old gaps unmapped and still drops what has no tool here', () => {
    expect(list('TodoWrite', 'EnterPlanMode', 'LSP', 'EnterWorktree', 'PushNotification')).toEqual(
      [],
    )
  })

  it('names the always-on infrastructure and keeps it out of the switch-off set', () => {
    expect(CC_ALWAYS_ON_TOOLS).toContain('ToolSearch')
    expect(CC_ALWAYS_ON_TOOLS).toContain('ToolOutput')
    const off = new Set(Object.values(CC_TOOL_NAME_MAP))
    for (const name of CC_ALWAYS_ON_TOOLS) expect(off.has(name)).toBe(false)
    // Localix-only tools are switched off by a `tools` list, as Claude Code's exact list does.
    for (const name of ['Plan', 'Loops', 'Workflow', 'Jobs', 'Browser', 'McpResources'])
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
      'monitor',
    ])
      expect(CC_SEMANTIC_GAPS[name]).toBeString()
  })
})

describe('a denylist with specifiers', () => {
  it('keeps Tool(specifier) entries in engine form beside whole-tool entries', () => {
    expect(mapCcRuleList(['Bash(rm *)', 'Read(.env)', 'Write', 'TodoWrite'])).toEqual([
      'Bash(rm *)',
      'Read(.env)',
      'Write',
    ])
    expect(mapCcRuleList(['"Bash(git push:*)"', 'Bash(git push:*)'])).toEqual(['Bash(git push:*)'])
  })

  it('splits whole-tool entries, which switch a tool off, from pattern entries, which only deny', () => {
    expect(splitDenyList(['Bash(rm *)', 'Write', 'Read(*)', 'Grep'])).toEqual({
      tools: ['Write', 'Read', 'Search'],
      patterned: ['Bash(rm *)'],
    })
  })
})
