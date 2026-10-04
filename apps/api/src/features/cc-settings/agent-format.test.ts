import { describe, expect, test } from 'bun:test'
import { decodeClaudeCodeAgent } from './agent-format'
import { verdictIn } from '../capabilities/rule'

const source = 'plugin/agents/reviewer.md'
const markdown = (fields = '') =>
  `---\nname: reviewer\ndescription: Review changes\n${fields}---\nReview the patch.\n`

describe('Claude Code agent format boundary', () => {
  test('separates native behavior, policy proposals and provenance', () => {
    const result = decodeClaudeCodeAgent(
      markdown(
        'tools: [Read, Bash]\ndisallowedTools: [Write]\nmodel: opus\neffort: high\nmaxTurns: 12\nskills: [review]\nmemory: project\n',
      ),
      source,
    )
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('Expected accepted artifact')
    expect(result.value.definition).toEqual({
      handle: 'reviewer',
      description: 'Review changes',
      instructions: 'Review the patch.',
      leadershipPriority: 0,
      modelPreference: { model: 'opus', effort: 'high' },
      limits: { maxTurns: 12 },
      context: { preloadSkills: ['review'], memory: { scope: 'project' } },
    })
    expect(result.source).toBe(source)
    const rules = result.value.policyProposals
    expect(verdictIn(rules, 'tool:read', '/file')?.effect).toBe('allow')
    expect(verdictIn(rules, 'tool:bash', 'git status')?.effect).toBe('allow')
    expect(verdictIn(rules, 'tool:write', '/file')?.effect).toBe('deny')
    expect(verdictIn(rules, 'tool:research', '*')?.effect).toBe('deny')
  })

  test('argument restrictions never become whole-tool grants', () => {
    const result = decodeClaudeCodeAgent(markdown('tools: ["Bash(git status:*)"]\n'), source)
    if (result.status !== 'accepted') throw new Error('Expected accepted artifact')
    const rules = result.value.policyProposals
    expect(verdictIn(rules, 'tool:bash', 'git status')?.effect).toBe('allow')
    expect(verdictIn(rules, 'tool:bash', 'git status --short')?.effect).toBe('allow')
    expect(verdictIn(rules, 'tool:bash', 'git status-malicious')?.effect).toBe('deny')
    expect(verdictIn(rules, 'tool:bash', 'rm -rf dir')?.effect).toBe('deny')
  })

  test('an explicit empty allowlist differs from an absent list', () => {
    const absent = decodeClaudeCodeAgent(markdown(), source)
    const empty = decodeClaudeCodeAgent(markdown('tools: []\n'), source)
    if (absent.status !== 'accepted' || empty.status !== 'accepted')
      throw new Error('Expected accepted artifacts')
    expect(absent.value.policyProposals).toEqual([])
    expect(empty.value.policyProposals).toEqual([
      { action: 'tool:*', resource: '*', effect: 'deny' },
    ])
  })

  test('wildcard allow still respects subsequent deny declarations', () => {
    const result = decodeClaudeCodeAgent(
      markdown('tools: ["*"]\ndisallowedTools: [Bash]\n'),
      source,
    )
    if (result.status !== 'accepted') throw new Error('Expected accepted artifact')
    expect(verdictIn(result.value.policyProposals, 'tool:read', '*')?.effect).toBe('allow')
    expect(verdictIn(result.value.policyProposals, 'tool:bash', '*')?.effect).toBe('deny')
  })

  test.each([
    'tools: [UnknownTool]\n',
    'disallowedTools: [UnknownTool]\n',
    'disallowedTools: [constructor]\n',
    'disallowedTools: [mcp__]\n',
    'tools: ["Read(/private/**)"]\n',
    'tools: ["Bash(git [a-z]*)"]\n',
    'permissionMode: bypassPermissions\n',
    'hooks: { Stop: [] }\n',
    'mcpServers: [private]\n',
    'isolation: worktree\n',
    'memory: local\n',
    'futureSecurityField: true\n',
  ])('unsupported constraints reject the complete artifact: %s', (fields) => {
    const result = decodeClaudeCodeAgent(markdown(fields), source)
    expect(result.status).toBe('rejected')
    expect('value' in result).toBe(false)
    expect(result.diagnostics.some((item) => item.status === 'unsupported')).toBe(true)
  })

  test.each([
    'tools: true\n',
    'maxTurns: -1\n',
    'maxTurns: null\n',
    'skills: [true]\n',
    'model: []\n',
    'model: ""\n',
  ])('invalid values are diagnosed: %s', (fields) => {
    expect(decodeClaudeCodeAgent(markdown(fields), source).status).toBe('rejected')
  })

  test('malformed YAML cannot fall back to a lossy flat parser', () => {
    expect(decodeClaudeCodeAgent(markdown('tools: [Read\n'), source).status).toBe('rejected')
  })

  test('presentation hints remain diagnostics, not agent fields', () => {
    const result = decodeClaudeCodeAgent(markdown('color: blue\n'), source)
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('Expected accepted artifact')
    expect('color' in result.value.definition).toBe(false)
    expect(result.diagnostics).toContainEqual({
      field: 'color',
      status: 'unsupported',
      impact: 'presentation',
      message: 'This field has no native contribution translator yet',
    })
  })
})
