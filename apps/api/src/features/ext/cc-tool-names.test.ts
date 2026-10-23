import { describe, it, expect } from 'bun:test'
import {
  CC_TOOL_NAME_MAP,
  CC_SEMANTIC_GAPS,
  normalizeCcToolName,
  normalizeMcpToolAlias,
  mapCcToolList,
} from './cc-tool-names'

describe('CC_TOOL_NAME_MAP', () => {
  it('contains the canonical CC→engine mappings', () => {
    expect(CC_TOOL_NAME_MAP['read']).toBe('read')
    expect(CC_TOOL_NAME_MAP['bash']).toBe('bash')
    expect(CC_TOOL_NAME_MAP['grep']).toBe('search')
    expect(CC_TOOL_NAME_MAP['glob']).toBe('search')
    expect(CC_TOOL_NAME_MAP['ls']).toBe('search')
    expect(CC_TOOL_NAME_MAP['write']).toBe('write')
    expect(CC_TOOL_NAME_MAP['edit']).toBe('edit')
    expect(CC_TOOL_NAME_MAP['multiedit']).toBe('edit')
    expect(CC_TOOL_NAME_MAP['agent']).toBeUndefined()
    expect(CC_TOOL_NAME_MAP['task']).toBeUndefined()
    // CC task and team tools have no core equivalent: a task board is a plugin's tool, and
    // mapping to it would resolve a CC name to a plugin core cannot know is installed.
    for (const name of [
      'todowrite',
      'todoread',
      'taskcreate',
      'taskupdate',
      'tasklist',
      'taskget',
      'teamcreate',
      'teamdelete',
    ])
      expect(CC_TOOL_NAME_MAP[name]).toBeUndefined()
    expect(CC_TOOL_NAME_MAP['sendmessage']).toBeUndefined()
    // One composite engine capability preserves both legacy authorities.
    expect(CC_TOOL_NAME_MAP['webfetch']).toBe('research')
    expect(CC_TOOL_NAME_MAP['websearch']).toBe('research')
    expect(CC_TOOL_NAME_MAP['askuserquestion']).toBe('ask')
    expect(CC_TOOL_NAME_MAP['exitplanmode']).toBeUndefined()
  })

  it('is immutable (Readonly)', () => {
    // TypeScript enforces this at compile time; just verify the value exists
    expect(typeof CC_TOOL_NAME_MAP).toBe('object')
  })
})

describe('CC_SEMANTIC_GAPS', () => {
  it('contains the semantic-gap entries', () => {
    expect(CC_SEMANTIC_GAPS['sendmessage']).toBeUndefined()
    // MultiEdit is native now: `edit` takes an ordered `edits` array.
    expect(CC_SEMANTIC_GAPS['multiedit']).toBeUndefined()
    expect(CC_SEMANTIC_GAPS['notebookedit']).toContain('`edit`')
    // An unmapped name is dropped, not approximated — a gap note would describe a mapping
    // that no longer exists.
    expect(CC_SEMANTIC_GAPS['teamcreate']).toBeUndefined()
    expect(CC_SEMANTIC_GAPS['teamdelete']).toBeUndefined()
  })

  it('no longer flags webfetch/websearch as gaps (they map to real engine tools)', () => {
    expect(CC_SEMANTIC_GAPS['webfetch']).toBeUndefined()
    expect(CC_SEMANTIC_GAPS['websearch']).toBeUndefined()
  })
})

describe('normalizeCcToolName', () => {
  it('maps known CC names to engine names (case-insensitive)', () => {
    expect(normalizeCcToolName('Read')).toBe('read')
    expect(normalizeCcToolName('Bash')).toBe('bash')
    expect(normalizeCcToolName('Grep')).toBe('search')
    expect(normalizeCcToolName('Glob')).toBe('search')
    expect(normalizeCcToolName('Write')).toBe('write')
    expect(normalizeCcToolName('MultiEdit')).toBe('edit')
    expect(normalizeCcToolName('Agent')).toBe('agent')
    expect(normalizeCcToolName('Task')).toBe('task')
    expect(normalizeCcToolName('Task(subagent_type: reviewer)')).toBe('task')
    expect(normalizeCcToolName('TodoWrite')).toBe('todowrite')
    expect(normalizeCcToolName('AskUserQuestion')).toBe('ask')
  })

  it('passes through engine names unchanged (lowercase identity)', () => {
    expect(normalizeCcToolName('bash')).toBe('bash')
    expect(normalizeCcToolName('read')).toBe('read')
    expect(normalizeCcToolName('search')).toBe('search')
    expect(normalizeCcToolName('research')).toBe('research')
  })

  it('strips CC pattern syntax before mapping (e.g. Bash(git *))', () => {
    expect(normalizeCcToolName('Bash(git *)')).toBe('bash')
    expect(normalizeCcToolName('Grep(*.ts)')).toBe('search')
  })

  it('strips YAML quotes from the token', () => {
    expect(normalizeCcToolName('"Read"')).toBe('read')
    expect(normalizeCcToolName("'Bash'")).toBe('bash')
  })

  it('returns the lowercased input for unknown CC tool names (pass-through policy)', () => {
    // Unknown names pass through lowercased — caller decides what to do.
    expect(normalizeCcToolName('NotARealTool')).toBe('notarealtool')
    expect(normalizeCcToolName('SomeFutureCcTool')).toBe('somefuturecctool')
  })

  it('returns lowercased input for unrecognized names', () => {
    expect(normalizeCcToolName('XyzUnknown')).toBe('xyzunknown')
  })
})

describe('mapCcToolList', () => {
  it('maps known CC names to engine names', () => {
    const result = mapCcToolList(['Read', 'Bash', 'Grep'], {
      dropUnknown: true,
    })
    expect(result).toEqual(['read', 'bash', 'search'])
  })

  it('deduplicates: Grep and Glob both map to search', () => {
    const result = mapCcToolList(['Grep', 'Glob', 'Ls'], { dropUnknown: true })
    expect(result).toEqual(['search'])
  })

  it('drops unknown CC tool names when dropUnknown is true', () => {
    const result = mapCcToolList(['Bash', 'UnknownCcTool', 'Read'], {
      dropUnknown: true,
    })
    expect(result).toEqual(['bash', 'read'])
  })

  it('passes through unknown names lowercased when dropUnknown is false', () => {
    const result = mapCcToolList(['Bash', 'UnknownCcTool'], {
      dropUnknown: false,
    })
    expect(result).toEqual(['bash', 'unknowncctool'])
  })

  it('never turns BashOutput/KillShell into the shell: a read-only list stays read-only', () => {
    // feature-dev's code-explorer list; neither name runs a command (now TaskOutput/TaskStop).
    const list = ['Glob', 'Grep', 'LS', 'Read', 'NotebookRead', 'WebFetch', 'TodoWrite']
    const result = mapCcToolList([...list, 'WebSearch', 'KillShell', 'BashOutput'], {
      dropUnknown: true,
    })
    expect(result).toEqual(['search', 'read', 'research'])
  })

  it('keeps Skill, so a `tools` list that omits it switches skills off', () => {
    expect(mapCcToolList(['Read', 'Skill'], { dropUnknown: true })).toEqual(['read', 'skill'])
    expect(mapCcToolList(['Read'], { dropUnknown: true })).toEqual(['read'])
  })

  it('returns empty array for an empty input list', () => {
    expect(mapCcToolList([], { dropUnknown: true })).toEqual([])
  })

  it('returns undefined-equivalent (empty array) when all inputs are unknown and dropUnknown is true', () => {
    // all-unmapped → empty array; caller should treat [] as undefined/default surface
    const result = mapCcToolList(['NotReal', 'AlsoNotReal'], {
      dropUnknown: true,
    })
    expect(result).toEqual([])
  })

  it('handles mixed CC + engine names (engine names pass through via map identity)', () => {
    // "bash" is in CC_TOOL_NAME_MAP as bash→bash, so it passes through
    const result = mapCcToolList(['bash', 'Grep', 'Read'], {
      dropUnknown: true,
    })
    expect(result).toEqual(['bash', 'search', 'read'])
  })

  it('strips CC pattern syntax from tokens', () => {
    const result = mapCcToolList(['Bash(git *)', 'Grep(*.ts)'], {
      dropUnknown: true,
    })
    expect(result).toEqual(['bash', 'search'])
  })
})

describe('normalizeMcpToolAlias', () => {
  it('maps the CC mcp__server__tool form to the engine mcp_server_tool form', () => {
    expect(normalizeMcpToolAlias('mcp__github__get_issue')).toBe('mcp_github_get_issue')
    expect(normalizeMcpToolAlias('mcp__git-hub__get_issue')).toBe('mcp_git_hub_get_issue')
  })

  it('preserves case (server/tool names are not lowercased)', () => {
    expect(normalizeMcpToolAlias('mcp__GitHub__getIssue')).toBe('mcp_GitHub_getIssue')
  })

  it('returns undefined for non-mcp names', () => {
    expect(normalizeMcpToolAlias('bash')).toBeUndefined()
    expect(normalizeMcpToolAlias('mcp_github_get_issue')).toBeUndefined()
  })
})

describe('normalizeCcToolName / mapCcToolList — MCP aliases', () => {
  it('normalizeCcToolName aliases the CC mcp__ form', () => {
    expect(normalizeCcToolName('mcp__github__get_issue')).toBe('mcp_github_get_issue')
    // Engine form passes through unchanged (lowercased only for the fallback path).
    expect(normalizeCcToolName('mcp_github_get_issue')).toBe('mcp_github_get_issue')
  })

  it('mapCcToolList aliases mcp__ names and dedupes alongside engine tools', () => {
    expect(mapCcToolList(['mcp__github__get_issue', 'Read'], { dropUnknown: true })).toEqual([
      'mcp_github_get_issue',
      'read',
    ])
  })

  it('strips CC pattern syntax on mcp__ names', () => {
    expect(normalizeCcToolName('mcp__github__get_issue(foo)')).toBe('mcp_github_get_issue')
  })
})

describe('MCP addresses map to the name the engine registers', () => {
  it("drops Claude Code's plugin_ server prefix: a plugin's server record is <plugin>_<server>", () => {
    // `plugins/mcp.ts` names the record `<plugin>_<server>`; `mcp/mcp-tools.ts` sanitizes.
    expect(normalizeMcpToolAlias('mcp__plugin_e2e-ag_ctl__echo')).toBe('mcp_e2e_ag_ctl_echo')
    expect(normalizeCcToolName('mcp__plugin_p_db__run_query')).toBe('mcp_p_db_run_query')
  })

  it("keeps a server's * and a tool's own double underscore", () => {
    expect(normalizeMcpToolAlias('mcp__github__*')).toBe('mcp_github_*')
    expect(normalizeMcpToolAlias('mcp__plugin_p_ctl__*')).toBe('mcp_p_ctl_*')
    expect(normalizeMcpToolAlias('mcp__github__get__issue')).toBe('mcp_github_get__issue')
  })

  it('keeps the case of an engine MCP name and keeps it in a frontmatter list', () => {
    expect(normalizeCcToolName('mcp_GitHub_getIssue')).toBe('mcp_GitHub_getIssue')
    expect(
      mapCcToolList(['Read', 'mcp__plugin_p_ctl__echo', 'mcp_GitHub_getIssue'], {
        dropUnknown: true,
      }),
    ).toEqual(['read', 'mcp_p_ctl_echo', 'mcp_GitHub_getIssue'])
  })
})
