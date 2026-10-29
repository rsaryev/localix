import { beforeAll, describe, expect, test } from 'bun:test'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { z } from 'zod'

import { DEFAULT_AGENT_NAME } from '../../db/author'
import { builtinAgentPreset } from '../capabilities/builtin-agent-presets'
import { PERMISSION_MODES } from '../../contracts/permission-modes'
import { CORE_CALL_CASES, type CallCase } from './testing/core-call-cases'
import { contributedCallCases, matrixMismatches, type PresetUnderTest } from './testing/mode-matrix'
import { modeSurface, runRegistry } from './testing/run-surface'

/**
 * EVERY MODE × EVERY TOOL × EVERY SHIPPED PRESET, through the real gate.
 *
 * A mode is a rewrite of the agent's rules (`permission-mode-policy.ts`), and its promise is a
 * table: plan refuses what reaches past the conversation, bypass stops asking without starting
 * to destroy, autonomous also refuses what waits on a person. That promise is only as good as
 * the CLASS each tool gives each call — a misclassified write is a write plan mode lets through.
 * So the core tools' calls carry classes written by hand (`core-call-cases.ts`), checked against
 * the tool first; the tools a mini app contributes, which core may not name, are exercised action by
 * action with the class each states (`contributedCallCases`) — their hand-written classes are
 * pinned by each mini app's own tests.
 */

/**
 * A tool as a mini app contributes it: one tool, several actions, each with a class of its own.
 * Core knows no concrete mini app, so the roster carries this stand-in.
 */
const contributed = defineAgentTool({
  name: 'fixture_board',
  label: 'Fixture board',
  activeVerb: 'Using the board',
  description: 'A tool with a read action, a write action and a destructive one.',
  inputSchema: z.object({ action: z.enum(['list', 'add', 'clear']) }),
  mutates: true,
  classify: (input) => {
    const action = (input as { action?: string }).action
    if (action === 'list') return { effect: 'read' }
    if (action === 'clear') return { effect: 'files', irreversible: true }
    return { effect: 'files' }
  },
  execute: async () => ({ content: 'ok' }),
}) as unknown as AgentTool
const contributedTools: AgentTool[] = [contributed]
const tools = new Map<string, AgentTool>()
const pluginNames: string[] = []
const ALL_CASES: CallCase[] = [...CORE_CALL_CASES]

beforeAll(() => {
  pluginNames.push(...contributedTools.map((tool) => tool.name))
  for (const tool of runRegistry('chat', 'default', [], contributedTools).tools)
    tools.set(tool.name, tool)
  ALL_CASES.push(...contributedCallCases(contributedTools))
})

/**
 * The shipped presets. Only `localix` ships in code now: other roles are ordinary agents the user
 * owns, so the matrix pins the one preset whose roster is every tool a chat run builds.
 */
const PRESETS: PresetUnderTest[] = [DEFAULT_AGENT_NAME].map((name) => ({
  name,
  rules: builtinAgentPreset(name),
  onRoster: () => true,
  expected: () => undefined,
}))

describe('the roster under test', () => {
  test('every tool a chat run builds, a mini app’s included, has at least one case', () => {
    const covered = new Set(ALL_CASES.map((call) => call.tool))
    expect([...tools.keys()].filter((name) => !covered.has(name))).toEqual([])
  })

  test('the contributed cases reach past reads: some call of a mini app’s tool is not a read', () => {
    const cases = ALL_CASES.filter((call) => pluginNames.includes(call.tool))
    expect(cases.some((call) => call.cls.effect !== 'read')).toBe(true)
    expect(cases.length).toBeGreaterThan(pluginNames.length)
  })

  test('every shipped agent has a preset, and localix is among them', () => {
    expect(PRESETS.map((preset) => preset.name)).toContain('localix')
    for (const preset of PRESETS) expect(preset.rules.length).toBeGreaterThan(0)
  })
})

describe('the matrix', () => {
  test('every cell agrees with the decision table', async () => {
    expect(await matrixMismatches(PRESETS, ALL_CASES, tools, pluginNames)).toEqual([])
  })

  test('positive control: a write that calls itself a read is flagged, and the cost is named', async () => {
    const misfiled = defineAgentTool({
      name: 'misfiled_write',
      label: 'Misfiled write',
      activeVerb: 'Writing',
      description: 'Writes a file but tells the gate it only reads.',
      inputSchema: z.object({ path: z.string() }),
      mutates: true,
      classify: () => ({ effect: 'read' }),
      execute: async () => ({ content: 'wrote' }),
    }) as unknown as AgentTool
    const localix = PRESETS.filter((preset) => preset.name === 'localix')
    const findings = await matrixMismatches(
      localix,
      [
        {
          tool: 'misfiled_write',
          label: 'a write',
          input: { path: 'a' },
          cls: { effect: 'files' },
        },
      ],
      new Map([[misfiled.name, misfiled]]),
      [misfiled.name],
    )
    // The table is wrong, AND plan mode lets the write through because of it.
    expect(findings).toEqual([
      'misfiled_write (a write): classified {"effect":"read"}, the case says {"effect":"files"}',
      'localix/plan misfiled_write (a write): allow, expected deny',
    ])
  })
})

describe('what each mode tells the run', () => {
  test('only autonomous expects nobody to answer', () => {
    const reachable = PERMISSION_MODES.map((mode) => [
      mode,
      modeSurface(builtinAgentPreset('localix'), mode, []).humanReachable,
    ])
    expect(reachable).toEqual([
      ['default', true],
      ['plan', true],
      ['bypass', true],
      ['autonomous', false],
    ])
  })

  test('no mode removes a tool: the roster is the preset’s, the mode only refuses calls', () => {
    for (const preset of PRESETS) {
      const baseline = modeSurface(preset.rules, 'default', pluginNames).denied
      // Every shipped preset is `localix`, whose roster is every tool a chat run builds.
      const expected: string[] = []
      expect({ [preset.name]: [...baseline].sort() }).toEqual({
        [preset.name]: [...expected].sort(),
      })
      for (const mode of PERMISSION_MODES)
        expect({
          [`${preset.name}/${mode}`]: modeSurface(preset.rules, mode, pluginNames).denied,
        }).toEqual({ [`${preset.name}/${mode}`]: baseline })
    }
  })
})
