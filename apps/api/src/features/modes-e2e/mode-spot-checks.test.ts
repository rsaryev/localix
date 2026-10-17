import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'

import { builtinAgentPreset } from '../capabilities/builtin-agent-presets'
import { PERMISSION_MODES } from '../capabilities/permission-modes'
import type { Rule } from '../capabilities/rule'
import { WORKSPACE } from './core-call-cases'
import { modeSurface, runRegistry, type Decision } from './run-surface'

/**
 * THE SAME TABLE, WRITTEN OUT BY HAND — one row per core tool, four answers per row.
 *
 * The matrix derives each cell from a class and a rule of thumb; these rows state the cells
 * outright, so a change to the decision table itself (not just to one tool) shows up as a diff a
 * reviewer can read: "plan now allows `memory set`" rather than "the oracle changed".
 *
 * Columns: default, plan, bypass, autonomous — for `localix`, whose preset has no closed list.
 */
const TOOLS = new Map<string, AgentTool>(
  runRegistry('chat', 'default', []).tools.map((tool) => [tool.name, tool]),
)
const LOCALIX = builtinAgentPreset('localix')

type Row = [
  tool: string,
  input: Record<string, unknown>,
  answers: [Decision, Decision, Decision, Decision],
]
const A = 'allow' as const
const Q = 'ask' as const
const D = 'deny' as const

const ROWS: Row[] = [
  ['ask', { questions: [{ question: 'Which?' }] }, [A, A, A, D]],
  ['bash', { command: 'git status' }, [A, A, A, A]],
  ['bash', { command: 'npm install' }, [A, D, A, A]],
  ['bash', { command: 'git push --force origin main' }, [Q, D, A, A]],
  ['bash', { command: 'rm -rf ~' }, [Q, D, D, D]],
  ['bash', { command: 'tail -f app.log', background: true }, [A, A, A, A]],
  ['read', { path: `${WORKSPACE}/a.ts` }, [A, A, A, A]],
  ['read', { path: '/etc/hosts' }, [Q, Q, A, A]],
  ['read', { path: `${WORKSPACE}/a.png` }, [A, A, A, A]],
  ['search', { pattern: 'x' }, [A, A, A, A]],
  ['research', { query: 'x' }, [A, A, A, A]],
  ['write', { path: `${WORKSPACE}/a.ts`, content: 'x' }, [A, D, A, A]],
  ['write', { path: '/etc/motd', content: 'x' }, [Q, D, A, A]],
  ['edit', { path: `${WORKSPACE}/a.ts`, old_string: 'a', new_string: 'b' }, [A, D, A, A]],
  ['delegate', { task: 'look', title: 'Look' }, [A, A, A, A]],
  ['delegate', { action: 'close', run: 'sub-1' }, [A, A, A, A]],
  ['loops', { action: 'list' }, [A, A, A, A]],
  ['loops', { action: 'add', prompt: 'p', cadence: '* * * * *' }, [A, D, A, A]],
  ['plugin_build', { name: 'x' }, [A, D, A, A]],
  ['memory', { action: 'set', key: 'k', value: 'v', scope: 'session' }, [A, A, A, A]],
  ['memory', { action: 'set', key: 'k', value: 'v' }, [A, D, A, A]],
  ['history_search', { query: 'x' }, [A, A, A, A]],
  ['external_agent_sessions', { action: 'transcript', key: 'codex:s1' }, [A, A, A, A]],
  ['context_budget', {}, [A, A, A, A]],
  ['tool_output', { action: 'get', id: 'o' }, [A, A, A, A]],
  ['skill', { action: 'get', name: 'x' }, [A, A, A, A]],
  ['skill', { action: 'delete', name: 'x' }, [A, D, A, A]],
  ['jobs', { action: 'read', job_id: 'bg-1' }, [A, A, A, A]],
  // Plan mode may stop a job this conversation started (a read-only monitor it let run).
  ['jobs', { action: 'stop', job_id: 'bg-1' }, [A, A, A, A]],
  ['browser', { action: 'snapshot' }, [A, A, A, A]],
  ['browser', { action: 'evaluate', expression: '1' }, [A, D, A, A]],
  ['set_topic', { title: 'T', goal: 'G', previousTopicSummary: 'None.' }, [A, A, A, A]],
  ['skip_answer', {}, [A, A, A, A]],
  ['agents', { action: 'list' }, [A, A, A, A]],
  [
    'agents',
    {
      action: 'create',
      agents: [{ handle: 'qa', description: 'd', instructions: 'i', leadership_priority: 0 }],
    },
    [A, D, A, A],
  ],
  ['configure', { action: 'inspect', target: { kind: 'summary' } }, [A, A, A, A]],
  ['configure', { action: 'propose', change: {} }, [A, D, A, D]],
  ['vault', { action: 'get', key: 'K' }, [A, A, A, A]],
  ['vault', { action: 'create', key: 'K' }, [A, D, A, D]],
  ['plan', { action: 'present', title: 't', body: 'b' }, [A, A, A, A]],
  ['plan', { action: 'complete', summary: 's' }, [A, A, A, A]],
]

describe('localix, by hand', () => {
  test('the rows cover every tool a chat run builds', () => {
    const covered = new Set(ROWS.map(([tool]) => tool))
    expect([...TOOLS.keys()].filter((name) => !covered.has(name))).toEqual([])
  })

  for (const [tool, input, answers] of ROWS)
    test(`${tool} ${JSON.stringify(input)}`, async () => {
      const got: Decision[] = []
      for (const mode of PERMISSION_MODES)
        got.push(await modeSurface(LOCALIX, mode, []).decide(TOOLS.get(tool)!, input))
      expect(got).toEqual(answers)
    })
})

/**
 * "Bypass stops asking; it does not lift a denial." The bypass rewrite once turned EVERY `ask`
 * into an `allow` in place — including the presets' own class questions (`outside-workspace`,
 * `dangerous`), which sit LAST in every preset. Last match wins, so the converted row beat the
 * agent's own `deny` for any call it matched: a tool switched off for the agent became callable
 * with a path outside the workspace, and the projection, reading an `allow` as an exception,
 * put the tool back on the roster. These rows pin the fix.
 */
describe('a denial survives every mode, whatever the call touches', () => {
  // Where a preset writes its denials: BEFORE the baseline questions, which sit last. A row the
  // person switches off lands in the same place (`persistPermissionRule` keeps the guards last).
  const [outsideQuestion, dangerQuestion, ...invocations] = LOCALIX
  const DENY_READ_AND_BASH: Rule[] = [
    { action: 'tool:read', resource: '*', effect: 'deny' },
    { action: 'tool:bash', resource: '*', effect: 'deny' },
    outsideQuestion!,
    dangerQuestion!,
    ...invocations,
  ]
  // A closed list in the shape every shipped role has: deny all, allow the members, then ask.
  const CLOSED_TO_SEARCH: Rule[] = [
    { action: 'tool:*', resource: '*', effect: 'deny' },
    { action: 'tool:search', resource: '*', effect: 'allow' },
    outsideQuestion!,
    dangerQuestion!,
  ]

  test('the fixture is the preset: its first two rows are the baseline questions', () => {
    expect([outsideQuestion?.resource, dangerQuestion?.resource]).toEqual([
      'outside-workspace',
      'dangerous',
    ])
  })

  /** What a call meets: nothing at all when the tool was never built, else the gate. */
  const reach = async (
    rules: Rule[],
    mode: (typeof PERMISSION_MODES)[number],
    tool: string,
    input: object,
  ) => {
    const surface = modeSurface(rules, mode, [])
    return surface.denied.includes(tool) ? 'removed' : surface.decide(TOOLS.get(tool)!, input)
  }

  test.each([...PERMISSION_MODES])('%s: a tool the agent denied is never built', async (mode) => {
    expect(modeSurface(DENY_READ_AND_BASH, mode, []).denied).toEqual(['bash', 'read'])
    expect(await reach(DENY_READ_AND_BASH, mode, 'read', { path: '/etc/hosts' })).toBe('removed')
    expect(await reach(DENY_READ_AND_BASH, mode, 'bash', { command: 'git push --force' })).toBe(
      'removed',
    )
  })

  test.each([...PERMISSION_MODES])(
    '%s: a closed list keeps its outsiders unbuilt',
    async (mode) => {
      expect(
        await reach(CLOSED_TO_SEARCH, mode, 'write', { path: '/etc/motd', content: 'x' }),
      ).toBe('removed')
      expect(await reach(CLOSED_TO_SEARCH, mode, 'search', { pattern: 'x' })).toBe('allow')
    },
  )

  test('even past the roster, the gate itself refuses a denied tool in bypass', async () => {
    // The roster is the first line, the gate the second: a tool reached some other way (a stale
    // schema, a host that built it anyway) must still be refused, not allowed by a converted ask.
    const surface = modeSurface(DENY_READ_AND_BASH, 'bypass', [])
    expect(await surface.decide(TOOLS.get('read')!, { path: '/etc/hosts' })).toBe('deny')
  })

  test('bypass still answers yes to a question the agent wrote about a NAMED thing', async () => {
    const rules: Rule[] = [
      ...LOCALIX,
      { action: 'tool:bash', resource: '*', effect: 'deny' },
      { action: 'tool:bash', resource: 'git *', effect: 'ask' },
    ]
    const bash = TOOLS.get('bash')!
    expect(await modeSurface(rules, 'default', []).decide(bash, { command: 'git fetch' })).toBe(
      'ask',
    )
    expect(await modeSurface(rules, 'bypass', []).decide(bash, { command: 'git fetch' })).toBe(
      'allow',
    )
    expect(await modeSurface(rules, 'bypass', []).decide(bash, { command: 'make' })).toBe('deny')
  })
})
