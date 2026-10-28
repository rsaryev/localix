import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'

import { builtinAgentPreset } from '../capabilities/builtin-agent-presets'
import { PERMISSION_MODES } from '../../contracts/permission-modes'
import type { Rule } from '../agent-core/capability-rule'
import { WORKSPACE } from './testing/core-call-cases'
import { modeSurface, runRegistry, type Decision } from './testing/run-surface'

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
  ['AskUserQuestion', { questions: [{ question: 'Which?' }] }, [A, A, A, D]],
  ['Bash', { command: 'git status' }, [A, A, A, A]],
  ['Bash', { command: 'npm install' }, [A, D, A, A]],
  ['Bash', { command: 'git push --force origin main' }, [Q, D, A, A]],
  ['Bash', { command: 'rm -rf ~' }, [Q, D, D, D]],
  ['Bash', { command: 'tail -f app.log', background: true }, [A, A, A, A]],
  ['Read', { path: `${WORKSPACE}/a.ts` }, [A, A, A, A]],
  ['Read', { path: '/etc/hosts' }, [Q, Q, A, A]],
  ['Read', { path: `${WORKSPACE}/a.png` }, [A, A, A, A]],
  ['Search', { pattern: 'x' }, [A, A, A, A]],
  ['Research', { query: 'x' }, [A, A, A, A]],
  ['Write', { path: `${WORKSPACE}/a.ts`, content: 'x' }, [A, D, A, A]],
  ['Write', { path: '/etc/motd', content: 'x' }, [Q, D, A, A]],
  ['Edit', { path: `${WORKSPACE}/a.ts`, old_string: 'a', new_string: 'b' }, [A, D, A, A]],
  ['Agent', { description: 'Look', prompt: 'look' }, [A, A, A, A]],
  ['TaskStop', { task_id: 'sub-1' }, [A, A, A, A]],
  ['Loops', { action: 'list' }, [A, A, A, A]],
  ['Loops', { action: 'add', prompt: 'p', cadence: '* * * * *' }, [A, D, A, A]],
  ['GlobalSearch', { query: 'x' }, [A, A, A, A]],
  ['ExternalAgentSessions', { action: 'transcript', key: 'codex:s1' }, [A, A, A, A]],
  ['ContextBudget', {}, [A, A, A, A]],
  ['ToolOutput', { action: 'get', id: 'o' }, [A, A, A, A]],
  ['Skill', { action: 'get', name: 'x' }, [A, A, A, A]],
  ['Skill', { action: 'save', name: 'x', description: 'd', content: 'c' }, [A, D, A, A]],
  ['Jobs', { action: 'read', job_id: 'bg-1' }, [A, A, A, A]],
  // Plan mode may stop a job this conversation started (a read-only monitor it let run).
  ['SendMessage', { to: 'sub-1', message: 'go' }, [A, A, A, A]],
  ['Browser', { action: 'snapshot' }, [A, A, A, A]],
  ['Browser', { action: 'evaluate', expression: '1' }, [A, D, A, A]],
  ['Store', { action: 'search', query: 'x' }, [A, A, A, A]],
  // A change waits on a person's card: refused in plan, and in an autonomous session.
  ['Store', { action: 'install', ref: { kind: 'plugin', id: 'a@b' }, scope: 'user' }, [A, D, A, D]],
  [
    'Store',
    { action: 'create', kind: 'agent', scope: 'user', values: { name: 'qa', description: 'd' } },
    [A, D, A, D],
  ],
  ['Configure', { action: 'inspect', target: { kind: 'summary' } }, [A, A, A, A]],
  ['Configure', { action: 'propose', change: {} }, [A, D, A, D]],
  ['Vault', { action: 'get', key: 'K' }, [A, A, A, A]],
  ['Vault', { action: 'create', key: 'K' }, [A, D, A, D]],
  ['Plan', { action: 'present', title: 't', body: 'b' }, [A, A, A, A]],
  ['Plan', { action: 'complete', summary: 's' }, [A, A, A, A]],
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
    { action: 'tool:Read', resource: '*', effect: 'deny' },
    { action: 'tool:Bash', resource: '*', effect: 'deny' },
    outsideQuestion!,
    dangerQuestion!,
    ...invocations,
  ]
  // A closed list in the shape every shipped role has: deny all, allow the members, then ask.
  const CLOSED_TO_SEARCH: Rule[] = [
    { action: 'tool:*', resource: '*', effect: 'deny' },
    { action: 'tool:Search', resource: '*', effect: 'allow' },
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
    expect(modeSurface(DENY_READ_AND_BASH, mode, []).denied).toEqual(['Bash', 'Read'])
    expect(await reach(DENY_READ_AND_BASH, mode, 'Read', { path: '/etc/hosts' })).toBe('removed')
    expect(await reach(DENY_READ_AND_BASH, mode, 'Bash', { command: 'git push --force' })).toBe(
      'removed',
    )
  })

  test.each([...PERMISSION_MODES])(
    '%s: a closed list keeps its outsiders unbuilt',
    async (mode) => {
      expect(
        await reach(CLOSED_TO_SEARCH, mode, 'Write', { path: '/etc/motd', content: 'x' }),
      ).toBe('removed')
      expect(await reach(CLOSED_TO_SEARCH, mode, 'Search', { pattern: 'x' })).toBe('allow')
    },
  )

  test('even past the roster, the gate itself refuses a denied tool in bypass', async () => {
    // The roster is the first line, the gate the second: a tool reached some other way (a stale
    // schema, a host that built it anyway) must still be refused, not allowed by a converted ask.
    const surface = modeSurface(DENY_READ_AND_BASH, 'bypass', [])
    expect(await surface.decide(TOOLS.get('Read')!, { path: '/etc/hosts' })).toBe('deny')
  })

  test('bypass still answers yes to a question the agent wrote about a NAMED thing', async () => {
    const rules: Rule[] = [
      ...LOCALIX,
      { action: 'tool:Bash', resource: '*', effect: 'deny' },
      { action: 'tool:Bash', resource: 'git *', effect: 'ask' },
    ]
    const bash = TOOLS.get('Bash')!
    expect(await modeSurface(rules, 'default', []).decide(bash, { command: 'git fetch' })).toBe(
      'ask',
    )
    expect(await modeSurface(rules, 'bypass', []).decide(bash, { command: 'git fetch' })).toBe(
      'allow',
    )
    expect(await modeSurface(rules, 'bypass', []).decide(bash, { command: 'make' })).toBe('deny')
  })
})
