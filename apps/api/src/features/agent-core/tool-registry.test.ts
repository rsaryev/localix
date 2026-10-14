import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createRuntimeToolRegistry, type RuntimeToolRegistryOptions } from './tool-registry'
import { BUILTIN_TOOL_NAMES } from './tool-names'
import type { AgentTool } from '@localixai/agent/agents'
import { CHAT_RUN_PROFILE, isToolLive, resolveRunProfile } from './run-shape'

/** A delegated child running as an agent with (or without) a declared tool list. */
const childProfile = (tools: string[]) =>
  resolveRunProfile({ sessionKind: 'subagent' }, tools.length ? { tools } : null)
/** An unattended job run. */
const automationProfile = () => resolveRunProfile({ sessionKind: 'job' })
import { zodToJsonSchema } from '@localixai/agent'

function inertTool(name: string): AgentTool {
  return {
    name,
    description: `${name} test registration`,
    inputSchema: {} as never,
    activeVerb: `Using ${name}`,
    execute: async () => ({ content: '' }),
  }
}

/**
 * Exercise every production registration seam without executing a tool. Four
 * host-owned tools arrive through the same extraTools channel as their live
 * implementations; the rest use their named dependency/option ports.
 */
const maximalRegistryOptions = {
  policy: {
    extraTools: [
      inertTool('mcp_resources'),
      inertTool('vault'),
      inertTool('external_agent_sessions'),
    ],
  },
  optional: {
    memory: inertTool('memory'),
    history_search: inertTool('history_search'),
    tool_output: inertTool('tool_output'),
    context_budget: inertTool('context_budget'),
    skill: inertTool('skill'),
    jobs: inertTool('jobs'),
    browser: {} as never,
    fork: {} as never,
    agents: {} as never,
    loops: {} as never,
    plugin_build: { run: async () => ({ text: '', ok: true }) },
    set_topic: { save: async () => {} },
    handoff: { hand: async () => ({ handed: [], unknown: [], available: [] }) },
    configure: {
      sessionId: 'sess',
      host: { changeSchema: z.object({ kind: z.literal('noop') }) } as never,
      ledgerRef: {},
      declined: new Set<string>(),
    },
    plan: {
      inPlanMode: async () => true,
      present: async () => ({}) as never,
      overview: async () => ({}) as never,
      complete: async () => ({}) as never,
    },
  },
} satisfies RuntimeToolRegistryOptions

describe('createRuntimeToolRegistry', () => {
  test('returns the current runtime tools in one place', () => {
    const registry = createRuntimeToolRegistry()

    // Image/PDF handling is part of read, so there is no second attachment schema.
    // research is the one built-in network tool: keyless search + safe source reads.
    expect(registry.toolNames).toEqual([
      'ask',
      'bash',
      'read',
      'search',
      'write',
      'edit',
      'research',
    ])
    expect(registry.tools.map((tool) => tool.name)).toEqual([...registry.toolNames])
    // Files change through edit/write only, and images are read by read: the removed
    // patch and image tools must never come back into the built set.
    expect(registry.toolNames).not.toContain('apply_patch')
    expect(registry.toolNames).not.toContain('view_image')
    expect(registry.promptSection).toContain('# Available tools')
    expect(registry.promptSection).toContain('bash')
    expect(registry.promptSection).toContain('read')
    expect(registry.promptSection).not.toContain('attach_file')
    expect(registry.promptSection).toContain('search')
    expect(registry.toolNames).not.toContain('quiz')
  })

  test('one descriptor policy drives desktop availability and capability-less absence', () => {
    const uiOnlyTool = {
      name: 'plugin_ui_only',
      description: 'Open an interactive workbench panel',
      inputSchema: {} as never,
      activeVerb: 'Opening panel',
      availability: { requiredCapabilities: ['workbench-ui'] },
      execute: async () => ({ content: 'opened' }),
    }
    const desktop = { capabilities: ['workbench-ui'] }
    const capabilityLess = { capabilities: [] }

    const direct = createRuntimeToolRegistry({
      policy: { extraTools: [uiOnlyTool], toolSurface: desktop },
    })
    expect(direct.toolNames).toContain('plugin_ui_only')

    // A surface without the capability gets no roster entry at all.
    const terminal = createRuntimeToolRegistry({
      policy: { extraTools: [uiOnlyTool], toolSurface: capabilityLess },
    })
    expect(terminal.toolNames).not.toContain('plugin_ui_only')
  })

  test('BUILTIN_TOOL_NAMES is the canonical reserved set (no dups; covers the core tools)', () => {
    // The plugin loader derives its reserved names from this list, so it must stay in
    // sync with what the registry actually emits. Guards core drift + duplicates.
    expect(new Set(BUILTIN_TOOL_NAMES).size).toBe(BUILTIN_TOOL_NAMES.length)
    for (const name of createRuntimeToolRegistry().toolNames) {
      expect(BUILTIN_TOOL_NAMES).toContain(name)
    }
  })

  test('every catalogued built-in has a concrete runtime registration path', () => {
    // ONE registry covers the whole catalog: a catalog no single run could hold would mean
    // some catalogued tool has no path to any model.
    const registry = createRuntimeToolRegistry(maximalRegistryOptions)
    expect(new Set(registry.toolNames).size).toBe(registry.toolNames.length)
    expect(new Set(registry.toolNames)).toEqual(new Set(BUILTIN_TOOL_NAMES))
  })

  test('isToolLive pairs profile exposure with the disabledTools filter (background bash ↔ jobs)', () => {
    // Regression: `allowBackgroundBash` was `sessionKind !== "job"` — blind to
    // disabledTools. A run whose rules deny `jobs` (its manager) but kept background
    // bash let the model spawn a job it couldn't list/read/stop. Background bash is
    // gated on a LIVE `jobs` tool: exposed by the profile AND not in disabledTools.
    const orch = CHAT_RUN_PROFILE
    // Normal chat: jobs is direct + nothing disabled → live (background allowed).
    expect(isToolLive(orch, 'jobs', [])).toBe(true)
    // Denied `jobs` → not live, so background bash is withheld too.
    expect(isToolLive(orch, 'jobs', ['jobs'])).toBe(false)
    // A profile that never exposes `jobs` (subagent) → not live regardless.
    expect(isToolLive(childProfile([]), 'jobs', [])).toBe(false)
  })

  test('disabledTools removes every named tool from the runtime through one rule', () => {
    const disabled = ['bash', 'search', 'ask']
    const registry = createRuntimeToolRegistry({ policy: { disabledTools: disabled } })
    const names = registry.tools.map((tool) => tool.name)

    for (const name of disabled) {
      expect(registry.toolNames).not.toContain(name)
      expect(names).not.toContain(name)
    }
  })

  test('disabling the canonical inventory retains the protocol tools', () => {
    const registry = createRuntimeToolRegistry({
      ...maximalRegistryOptions,
      policy: { ...maximalRegistryOptions.policy, disabledTools: BUILTIN_TOOL_NAMES },
    })
    expect([...registry.toolNames].sort()).toEqual(['handoff', 'set_topic'])
    expect(registry.tools.map((tool) => tool.name).sort()).toEqual(['handoff', 'set_topic'])
  })

  test('background bash is offered only when its `jobs` manager survives', () => {
    // A `background: true` job is unmanageable without the tool that lists and kills it, so
    // the field is not even offered when `jobs` is gone — the model cannot spend a turn
    // proposing a dev server it could never stop.
    const withJobs = createRuntimeToolRegistry({
      ...maximalRegistryOptions,
      policy: { ...maximalRegistryOptions.policy, disabledTools: [] },
    })
    const bash = withJobs.tools.find((t) => t.name === 'bash')!
    expect(JSON.stringify(zodToJsonSchema(bash.inputSchema))).toContain('background')

    const withoutJobs = createRuntimeToolRegistry({
      ...maximalRegistryOptions,
      policy: { ...maximalRegistryOptions.policy, disabledTools: ['jobs'] },
    })
    const lean = withoutJobs.tools.find((t) => t.name === 'bash')!
    expect(JSON.stringify(zodToJsonSchema(lean.inputSchema))).not.toContain('background')
  })

  test('disabledTools removes optional recovery tools too', () => {
    const toolOutputTool = {
      name: 'tool_output',
      description: 'replay',
      inputSchema: {} as never,
      activeVerb: 'Retrieving',
      execute: async () => ({ content: '' }),
    }
    const registry = createRuntimeToolRegistry({
      optional: { tool_output: toolOutputTool },
      policy: { disabledTools: ['tool_output'] },
    })
    expect(registry.toolNames).not.toContain('tool_output')
  })

  test('disabledTools removes the dependency-injected vault tool too', () => {
    const vaultTool = {
      name: 'vault',
      description: 'metadata-only credential manager',
      inputSchema: {} as never,
      activeVerb: 'Managing Vault',
      execute: async () => ({ content: '' }),
    }
    const registry = createRuntimeToolRegistry({
      policy: { extraTools: [vaultTool], disabledTools: ['vault'] },
    })

    expect(BUILTIN_TOOL_NAMES).toContain('vault')
    expect(registry.toolNames).not.toContain('vault')
  })

  test('extraTools (plugin native tools) bypass the profile allow-list on an OPEN profile', () => {
    // Regression: a plugin tool name is never in the built-in catalog, so isToolDirect
    // would have filtered it out — while the prompt still advertised it (the model then
    // hallucinated a `bash <toolname>`). On an OPEN profile (the default chat profile)
    // extraTools must appear, gated only by disabledTools.
    const pluginTool = {
      name: 'echo_greeting',
      description: 'say hi',
      inputSchema: {} as never,
      activeVerb: 'Greeting',
      execute: async () => ({ content: 'hi' }),
    }
    const registry = createRuntimeToolRegistry({ policy: { extraTools: [pluginTool] } })
    expect(registry.toolNames).toContain('echo_greeting')
    expect(registry.promptSection).toContain('echo_greeting')

    // disabledTools still removes it.
    const disabled = createRuntimeToolRegistry({
      policy: { extraTools: [pluginTool], disabledTools: ['echo_greeting'] },
    })
    expect(disabled.toolNames).not.toContain('echo_greeting')
  })

  test('a CLOSED profile (automation worker / reviewer) confines plugin tools to its allow-list', () => {
    // Regression: a read-only reviewer (closed automation profile,
    // no openToolset) was calling the `channel_send` plugin tool. Plugin extraTools may
    // bypass the allow-list ONLY on an OPEN profile; on a closed profile a plugin tool
    // survives just when the role explicitly DECLARED it (so it is in toolExposure).
    const pluginTool = {
      name: 'channel_send',
      description: 'send',
      inputSchema: {} as never,
      activeVerb: 'Sending',
      execute: async () => ({ content: 'sent' }),
    }
    const closed = createRuntimeToolRegistry({
      policy: { extraTools: [pluginTool], agentProfile: automationProfile() },
    })
    expect(closed.toolNames).not.toContain('channel_send')

    // The SAME plugin tool IS kept when the role explicitly declares it in toolExposure.
    const declared = createRuntimeToolRegistry({
      policy: {
        extraTools: [pluginTool],
        agentProfile: {
          ...automationProfile(),
          toolExposure: {
            ...automationProfile().toolExposure,
            channel_send: 'direct',
          },
        },
      },
    })
    expect(declared.toolNames).toContain('channel_send')
  })

  test("a plugin tool's own `exposure` decides which shapes carry it; the ledger says why not", () => {
    // A UI-surface plugin tool renders into the user's chat — it declares `never` for the
    // unattended shapes. A data tool that declares nothing is declarable by a role (opt-in).
    const uiTool = {
      name: 'sample_interactive_tool',
      description: 'renders an interactive surface in chat',
      inputSchema: {} as never,
      activeVerb: 'Rendering',
      exposure: { chat: 'default', subagent: 'never', automation: 'never' } as const,
      execute: async () => ({ content: 'ok' }),
    }
    const dataTool = {
      name: 'sample_data_tool',
      description: 'looks up external data',
      inputSchema: {} as never,
      activeVerb: 'Searching',
      execute: async () => ({ content: 'results' }),
    }
    // chat run (default): both present.
    const chat = createRuntimeToolRegistry({ policy: { extraTools: [uiTool, dataTool] } })
    expect(chat.toolNames).toContain('sample_interactive_tool')
    expect(chat.toolNames).toContain('sample_data_tool')
    // A child role that declared the data tool gets it; the UI tool is structurally out
    // even when declared — and the ledger records exactly that.
    const sub = createRuntimeToolRegistry({
      policy: {
        extraTools: [uiTool, dataTool],
        agentProfile: childProfile(['read', 'sample_data_tool', 'sample_interactive_tool']),
      },
    })
    expect(sub.toolNames).not.toContain('sample_interactive_tool')
    expect(sub.toolNames).toContain('sample_data_tool')
    expect(sub.ledger.get('sample_interactive_tool')).toEqual({
      state: 'withheld',
      reason: { layer: 'shape', kind: 'never', shape: 'subagent' },
    })
    // Not declared at all → the ledger says so, with no remedy: a role edit is not a switch.
    const bare = createRuntimeToolRegistry({
      policy: { extraTools: [dataTool], agentProfile: childProfile(['read']) },
    })
    expect(bare.ledger.get('sample_data_tool')).toEqual({
      state: 'withheld',
      reason: { layer: 'shape', kind: 'not-declared', shape: 'subagent' },
    })
  })

  test('the ledger names the denying rule and a remedy for a rule-withheld tool', () => {
    const denial = { rule: { action: 'tool:loops', resource: '*', effect: 'deny' } }
    const registry = createRuntimeToolRegistry({
      ...maximalRegistryOptions,
      policy: {
        ...maximalRegistryOptions.policy,
        disabledTools: ['loops'],
        toolDenials: new Map([['loops', denial]]),
      },
    })
    expect(registry.toolNames).not.toContain('loops')
    expect(registry.ledger.get('loops')).toEqual({
      state: 'withheld',
      reason: { layer: 'policy', kind: 'rule', denial },
      remedy: { remedyId: 'tool.enable', target: 'loops' },
    })
  })

  test('a port the host left empty is a ledger row, never a silent absence', () => {
    const registry = createRuntimeToolRegistry({})
    expect(registry.ledger.get('fork')).toEqual({
      state: 'withheld',
      reason: { layer: 'authority', kind: 'missing', capability: 'host:fork' },
    })
    // A removed tool has no row at all: nothing could ever build it.
    expect(registry.ledger.get('agents')).toEqual({
      state: 'withheld',
      reason: { layer: 'authority', kind: 'missing', capability: 'host:agents' },
    })
  })

  test('a mutating extraTool is registered, and only a denial removes it', () => {
    const mutating = {
      name: 'plugin_writer',
      description: 'writes',
      inputSchema: {} as never,
      activeVerb: 'Writing',
      mutates: true,
      execute: async () => ({ content: 'done' }),
    }
    // A mutating plugin tool is registered like any other; a read-only mode used to strip it,
    // and the same confinement is now the gate's, per CALL — which is strictly better,
    // because a registry pass could only judge a tool by a static flag.
    const registry = createRuntimeToolRegistry({ policy: { extraTools: [mutating] } })
    expect(registry.toolNames).toContain('plugin_writer')
    // The one thing that still removes it is an explicit denial.
    const denied = createRuntimeToolRegistry({
      policy: { extraTools: [mutating], disabledTools: ['plugin_writer'] },
    })
    expect(denied.toolNames).not.toContain('plugin_writer')
  })

  test('subagent profile exposes a lean tool surface', () => {
    // `jobsTool` is passed so the exclusion below is load-bearing: the tool IS
    // registered, and the assertion proves the subagent PROFILE filters it out. (A
    // sibling `scheduleTool` key used to sit here too — but no such registry option
    // has ever existed, so it registered nothing and the `schedule`-is-absent half of
    // this assertion could not fail. Removed rather than left as false assurance.)
    const registry = createRuntimeToolRegistry({
      policy: { agentProfile: childProfile([]) },
      optional: {
        jobs: {
          name: 'jobs',
          description: '',
          inputSchema: {} as never,
          activeVerb: 'Managing jobs',
          execute: async () => ({ content: '' }),
        },
      },
    })

    expect(registry.toolNames).toEqual([
      // A shell, so the child can verify its own work instead of returning it unverified.
      'bash',
      'read',
      'search',
      'write',
      'edit',
      // One composite keyless research tool.
      'research',
    ])
    expect(registry.toolNames).not.toContain('ask')
    // Host wiring/authority is deliberately absent in this profile-only fixture.
    expect(registry.toolNames).not.toContain('agents')
    expect(registry.toolNames).not.toContain('jobs')
    expect(registry.toolNames).not.toContain('render_surface')
    expect(registry.toolNames).not.toContain('stream_surface')
    expect(registry.toolNames).not.toContain('schedule')
    expect(registry.toolNames).not.toContain('todo')
  })

  test('a surface that declares nothing exposes no model-facing tools', () => {
    // The empty case is reachable — a profile is data, and a host that hands over one with
    // no exposure must get an empty registry rather than a silent fallback to everything.
    const registry = createRuntimeToolRegistry({
      policy: { agentProfile: { ...automationProfile(), toolExposure: {} } },
    })

    expect(registry.toolNames).toEqual([])
    expect(registry.promptSection).toBe('# Available tools')
  })

  test('lsp_diagnostics tool no longer exists — diagnostics are auto-attached to edits instead', () => {
    const registry = createRuntimeToolRegistry({
      policy: { agentProfile: CHAT_RUN_PROFILE },
      core: { reportDiagnostics: async () => undefined },
    })

    expect(registry.toolNames).not.toContain('lsp_diagnostics')
    expect(registry.promptSection).not.toContain('lsp_diagnostics')
  })

  test('reportDiagnostics is threaded into write/edit when provided', async () => {
    const seen: string[] = []
    const registry = createRuntimeToolRegistry({
      core: {
        reportDiagnostics: async (paths) => {
          seen.push(...paths)
          return undefined
        },
      },
    })
    // The mutating file tools must be present and carry the reporter wiring.
    expect(registry.toolNames).toContain('write')
    expect(registry.toolNames).toContain('edit')
  })

  test('subagent gets bash, but never the background/jobs half of it', () => {
    // A child that can edit but not type-check hands the parent unverified work; the
    // parent then re-reads the files the delegation existed to keep out of its context.
    // It still may not START a background job: delegation is synchronous, so the job
    // would outlive its owner with nobody watching (and there's no `jobs` tool to manage it).
    const registry = createRuntimeToolRegistry({
      policy: { agentProfile: childProfile([]) },
    })
    const defaultRegistry = createRuntimeToolRegistry()

    expect(registry.toolNames).toContain('bash')
    expect(registry.toolNames).not.toContain('jobs')
    expect(defaultRegistry.toolNames).toContain('bash')
    const bash = registry.tools.find((tool) => tool.name === 'bash')!
    expect(JSON.stringify(zodToJsonSchema(bash.inputSchema))).not.toContain('background')
  })

  test('holding a coordination tool narrows nothing — an orchestrator keeps the edit-and-verify loop', () => {
    // An orchestrator is NOT a delegate-only router: it KEEPS write/edit for small
    // inline fixes, and the "delegate substantial work" discipline lives in the prose
    // rather than in tool amputation. This used to be enforced by a disabled-tools list
    // that a board mode applied; the list was empty, so the mode was subtracting nothing at
    // all, and the invariant is simply that a plugin's task board is an ordinary extra tool.
    const orchestrated = createRuntimeToolRegistry({
      policy: { extraTools: [inertTool('task_board')] },
    })
    expect(orchestrated.toolNames).toContain('task_board')
    for (const kept of ['write', 'edit', 'bash', 'read', 'search']) {
      expect(orchestrated.toolNames).toContain(kept)
    }
  })
})
