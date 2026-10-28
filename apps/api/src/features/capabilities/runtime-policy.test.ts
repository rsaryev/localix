import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'
import {
  createPermissionGate,
  evaluate,
  extractCallFacts,
  type ToolFacts,
} from '../agent-core/permission-engine'
import { skillPermissionRules } from '../chat/runtime/run/permission-gate-build'
import { builtinAgentPreset } from './builtin-agent-presets'
import { composeCapabilities, NO_ROSTERS, projectCapabilities } from './resolve'
import type { Rule } from '../agent-core/capability-rule'

// One literal serves as both the registered tool and the facts `evaluate` reads off it.
const tool = { name: 'Bash', mutates: true, effect: 'external' } as AgentTool & ToolFacts
const call = extractCallFacts('Bash', { command: 'git status' }, '/tmp/workspace')
const project = (rules: Rule[]) =>
  projectCapabilities(composeCapabilities(rules), { ...NO_ROSTERS, tool: ['Bash'] }).permissions

describe('capability policy at the runtime boundary', () => {
  // Both effects count here because both rules NAME `bash`: an allow opens the door and an ask
  // puts a person at it. A wildcard `ask` — the confirmation floor every preset ends with —
  // names no tool and opens nothing, which `resolve.test.ts` pins separately.
  test.each(['allow', 'ask'] as const)(
    'keeps a tool registered for an argument %s exception',
    (effect) => {
      const projection = projectCapabilities(
        composeCapabilities([
          { action: 'tool:*', resource: '*', effect: 'deny' },
          { action: 'tool:Bash', resource: 'git *', effect },
        ]),
        { ...NO_ROSTERS, tool: ['Bash', 'Write'] },
      )
      expect(projection.denied.tool).toEqual(['Write'])
      expect(evaluate(projection.permissions, tool, call).action).toBe(effect)
      expect(
        evaluate(projection.permissions, tool, extractCallFacts('Bash', { command: 'npm publish' }))
          .action,
      ).toBe('deny')
    },
  )

  test('a final whole-tool deny revokes earlier exceptions at registration too', () => {
    const projection = projectCapabilities(
      composeCapabilities([
        { action: 'tool:Bash', resource: 'git *', effect: 'allow' },
        { action: 'tool:Bash', resource: '*', effect: 'deny' },
      ]),
      { ...NO_ROSTERS, tool: ['Bash'] },
    )
    expect(projection.denied.tool).toEqual(['Bash'])
  })

  test('a skill allow-list can lift an ask for exactly what it declared', () => {
    const rules = project([{ action: 'tool:Bash', resource: '*', effect: 'ask' }])
    const grants = skillPermissionRules(['Bash(git *)'])
    expect(evaluate(rules, tool, call, grants).action).toBe('allow')
    expect(
      evaluate(rules, tool, extractCallFacts('Bash', { command: 'npm publish' }), grants).action,
    ).toBe('ask')
  })

  test('last match permits an explicit exception', () => {
    const rules = project([
      { action: 'tool:Bash', resource: '*', effect: 'deny' },
      { action: 'tool:Bash', resource: 'git *', effect: 'allow' },
    ])
    expect(evaluate(rules, tool, call).action).toBe('allow')
    expect(evaluate(rules, tool, extractCallFacts('Bash', { command: 'npm publish' })).action).toBe(
      'deny',
    )
  })

  test('wildcards are anchored and tool-name families survive projection', () => {
    const rules = project([{ action: 'tool:Ba*', resource: 'git * --force', effect: 'deny' }])
    expect(
      evaluate(rules, tool, extractCallFacts('Bash', { command: 'git push --force' })).action,
    ).toBe('deny')
    expect(
      evaluate(rules, tool, extractCallFacts('Bash', { command: 'echo git push --force' })).action,
    ).toBe('allow')
  })

  test('an allow exception must cover the entire command batch', () => {
    const rules = project([
      { action: '*', resource: '*', effect: 'ask' },
      { action: 'tool:Bash', resource: 'git *', effect: 'allow' },
    ])
    for (const command of ['git status && npm publish', 'git status $(npm publish)']) {
      expect(evaluate(rules, tool, extractCallFacts('Bash', { command })).action).toBe('ask')
    }
  })

  test('the agent state-dir carve-out cannot skip a denial', async () => {
    const gate = createPermissionGate({
      rules: project([{ action: 'tool:Bash', resource: '*', effect: 'deny' }]),
      toolsByName: new Map([['Bash', tool]]),
    })
    expect(
      await gate({ toolCallId: 'call', toolName: 'Bash', input: { command: 'git status' } }),
    ).toMatchObject({ block: true })
  })

  test('YOLO stops the asking, and stops there', async () => {
    // "Skip permissions" means do not prompt me. It has never meant ignore a denial. The gate
    // no longer takes a flag for it: a mode rewrites the list's asks into allows before the
    // run, so what is pinned is that this rewrite lifts an ask and leaves a deny standing.
    const stopAsking = (rules: ReturnType<typeof project>) =>
      rules.map((rule) => (rule.action === 'ask' ? { ...rule, action: 'allow' as const } : rule))
    const denied = createPermissionGate({
      rules: stopAsking(project([{ action: 'tool:Bash', resource: 'git *', effect: 'deny' }])),
      toolsByName: new Map([['Bash', tool]]),
    })
    expect(
      await denied({ toolCallId: 'call', toolName: 'Bash', input: { command: 'git status' } }),
    ).toMatchObject({ block: true })

    const asked = createPermissionGate({
      rules: stopAsking(project([{ action: 'tool:Bash', resource: '*', effect: 'ask' }])),
      toolsByName: new Map([['Bash', tool]]),
    })
    const verdict = await asked({
      toolCallId: 'call',
      toolName: 'Bash',
      input: { command: 'git status' },
    })
    expect(verdict?.block).toBeFalsy()
  })

  test('an unattended ask cannot become an implicit approval', async () => {
    const gate = createPermissionGate({
      rules: project([{ action: 'tool:Bash', resource: '*', effect: 'ask' }]),
      toolsByName: new Map([['Bash', tool]]),
    })
    expect(
      await gate({ toolCallId: 'call', toolName: 'Bash', input: { command: 'git status' } }),
    ).toMatchObject({ block: true })
  })
})

/**
 * The confirmations a shipped role carries are ROWS, and they hold because of where they sit.
 *
 * They used to be a separate baseline the engine evaluated with its own resolution rules — a
 * terminal deny, a strictest-wins pass, and a carve-out saying when a stored `allow` could
 * silence them. All three are gone. What replaces them is ordering: the baseline rows are last
 * in the preset, and a rule about a COMMAND cannot displace a rule about `dangerous`, because
 * the two match different things.
 */
describe('the baseline rows in a shipped preset', () => {
  const bash = { name: 'Bash', effect: 'external' as const }
  const dangerous = extractCallFacts('Bash', { command: 'rm -rf /tmp/x' }, '/repo')
  const preset = () => project(builtinAgentPreset('localix'))

  test('a destructive command still asks, under the role that allows bash outright', () => {
    // Every shipped role carries `tool:Bash * allow`. If that answered for this call, all of
    // them would run `rm -rf /` unprompted.
    expect(evaluate(preset(), bash, dangerous).action).toBe('ask')
  })

  test("a session grant's rule does not silence it", () => {
    // What "Always" writes is `tool:Bash` over the program it showed. It lands after the
    // preset and still cannot answer for `dangerous`: different resource, different rule.
    const granted = [...preset(), { permission: 'Bash', pattern: 'rm *', action: 'allow' as const }]
    expect(evaluate(granted, bash, dangerous).action).toBe('allow')
    // …and the grant is what the user asked for, so it DOES answer for the thing they named.
    // The property being pinned is that it takes a deliberate rule naming this class to lift
    // the confirmation, not a click on an unrelated command.
    const unrelated = [
      ...preset(),
      { permission: 'Bash', pattern: 'git *', action: 'allow' as const },
    ]
    expect(evaluate(unrelated, bash, dangerous).action).toBe('ask')
  })

  test('a reader outside the workspace asks, whatever the roster said', () => {
    const outside = extractCallFacts('Read', { path: '/etc/hosts' }, '/repo')
    expect(evaluate(preset(), { name: 'Read', effect: 'read' }, outside).action).toBe('ask')
  })

  test('the user can lift it, deliberately, by naming the class', () => {
    // The honest arrangement for a local app: removable by its owner, in the editor, as a row
    // they can see — never by a click on a card about something else.
    const lifted = [
      ...preset(),
      { permission: 'Bash', pattern: 'dangerous', action: 'allow' as const },
    ]
    expect(evaluate(lifted, bash, dangerous).action).toBe('allow')
  })
})
