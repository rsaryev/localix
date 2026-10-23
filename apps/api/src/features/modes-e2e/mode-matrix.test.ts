import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { z } from 'zod'

import { BUILTIN_AGENTS } from '../agents/builtin'
import { builtinAgentPreset } from '../capabilities/builtin-agent-presets'
import { PERMISSION_MODES } from '../../contracts/permission-modes'
import { loadBundledPluginTools, type LoadedBundledTools } from './testing/bundled-plugin-tools'
import { CORE_CALL_CASES, WORKSPACE, type CallCase } from './testing/core-call-cases'
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
 * the tool first; the bundled plugins' tools, which core may not name, are exercised action by
 * action with the class each states (`contributedCallCases`) — their hand-written classes are
 * pinned by each plugin's own `classify.test.ts`.
 */
let plugins: LoadedBundledTools
const tools = new Map<string, AgentTool>()
const pluginNames: string[] = []
const ALL_CASES: CallCase[] = [...CORE_CALL_CASES]

beforeAll(async () => {
  plugins = await loadBundledPluginTools(WORKSPACE)
  pluginNames.push(...plugins.tools.map((tool) => tool.name))
  for (const tool of runRegistry('chat', 'default', [], plugins.tools).tools)
    tools.set(tool.name, tool)
  ALL_CASES.push(...contributedCallCases(plugins.tools))
})
afterAll(async () => {
  await plugins?.dispose()
})

/**
 * The shipped presets. Only `localix` ships in code now: other roles are ordinary agents the user
 * owns, so the matrix pins the one preset whose roster is every tool a chat run builds.
 */
// The person's record (`@human`) is never run, so it has no permission preset to check.
const PRESETS: PresetUnderTest[] = BUILTIN_AGENTS.filter((agent) => agent.kind !== 'human').map(
  (agent) => ({
    handle: agent.handle,
    rules: builtinAgentPreset(agent.handle),
    onRoster: () => true,
    expected: () => undefined,
  }),
)

describe('the roster under test', () => {
  test('the bundled plugins load through the host loader, and some carry tools', () => {
    expect(plugins.failures).toEqual([])
    expect(pluginNames.length).toBeGreaterThan(10)
  })

  test('every tool a chat run builds, plugin tools included, has at least one case', () => {
    const covered = new Set(ALL_CASES.map((call) => call.tool))
    expect([...tools.keys()].filter((name) => !covered.has(name))).toEqual([])
  })

  test('the contributed cases reach past reads: some plugin call is not a read', () => {
    const contributed = ALL_CASES.filter((call) => pluginNames.includes(call.tool))
    expect(contributed.some((call) => call.cls.effect !== 'read')).toBe(true)
    expect(contributed.length).toBeGreaterThan(pluginNames.length)
  })

  test('every shipped agent has a preset, and localix is among them', () => {
    expect(PRESETS.map((preset) => preset.handle)).toContain('localix')
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
    const localix = PRESETS.filter((preset) => preset.handle === 'localix')
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
      expect({ [preset.handle]: [...baseline].sort() }).toEqual({
        [preset.handle]: [...expected].sort(),
      })
      for (const mode of PERMISSION_MODES)
        expect({
          [`${preset.handle}/${mode}`]: modeSurface(preset.rules, mode, pluginNames).denied,
        }).toEqual({ [`${preset.handle}/${mode}`]: baseline })
    }
  })
})
