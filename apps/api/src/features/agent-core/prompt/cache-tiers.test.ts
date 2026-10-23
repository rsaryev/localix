import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { RUNTIME_CONTEXT_MARKER } from '@localixai/agent/chat-cache'

import { PROMPT_SECTIONS } from './catalog'
import { buildAgentSystemPrompt } from './assemble'
import { createRuntimeToolRegistry } from '../tool-registry'
import { TOOL } from '../tool-names'

/**
 * Which side of the prompt-cache boundary each prompt section belongs on, by its heading.
 *
 * `buildAgentSystemPrompt` emits `# Runtime context` as the marker splitting the prompt in two,
 * and the run path caches everything ABOVE it as a stable prefix. So a section's position is not
 * a layout choice, it is a cost decision:
 *
 *  - `stable`   — inside the cacheable prefix. Putting per-turn content here rewrites the prefix
 *                 every turn, and the whole system+tools prefix misses cache with it. That is the
 *                 most expensive mistake available in the prompt.
 *  - `volatile` — in the tail the run moves out of the cached prefix. Putting session-stable
 *                 content here is the cheap mistake: correct output, needlessly excluded from
 *                 the cross-session cache.
 *
 * The declaration is each section's own `tier` in the catalog, with the reason beside it, and
 * this table is read off it. This file compares it against a real render: a heading
 * that renders but no section declares fails, and so does a section whose text lands on the other
 * side of the marker than its tier says.
 *
 * Scope is exactly the sections the catalog positions relative to the marker. Model-facing text
 * assembled elsewhere — a skill tool's result, the runtime sections a host adds — is not placed
 * against this boundary and is deliberately absent.
 *
 * Token ceilings are NOT declared here. They are enforced where the content is assembled
 * (`capAggregatePromptContext`, `SKILL_LISTING_BUDGET`, `BACKGROUND_JOB_PROMPT_MAX_ITEMS`), and a
 * second, unenforced copy of that number would only be free to drift from it.
 */
type PromptCacheTier = 'stable' | 'volatile'

const PROMPT_SECTION_CACHE_TIERS: Readonly<Record<string, PromptCacheTier>> = Object.fromEntries(
  PROMPT_SECTIONS.flatMap((section) =>
    section.heading
      ? [[section.heading, section.tier === 'stable' ? 'stable' : 'volatile'] as const]
      : [],
  ),
)

/**
 * The declaration is checked against a real render, not against prose. Everything that can
 * turn a section on is turned on, both with and without the tools that gate sections, so the
 * observed set is as close to complete as one process can make it. (It used to sweep agent
 * modes too; sections gate on TOOLS now, which is the axis that was always doing the work.)
 */
const stubTool = (name: string) =>
  ({ name, description: name, parameters: {}, execute: async () => '' }) as never

const registries = {
  // With the gating tools: `# Available skills` and `# Delegate roles` only exist when the
  // tool that acts on them does.
  full: createRuntimeToolRegistry({
    // One tool switched off by a rule, so the ledger has a remediable withhold and
    // `# Unavailable tools` renders (it needs `configure` live AND something to list).
    policy: { disabledTools: [TOOL.loops] },
    optional: {
      skill: stubTool(TOOL.skill),
      jobs: stubTool(TOOL.jobs),
      // The port is BUILT (the host wires it whenever the profile exposes it); only the rule
      // withholds it — which is what makes the withhold remediable.
      loops: { userId: 'u', sessionId: 'sess', agentId: 'lead' },
      set_topic: { save: async () => {} },
      configure: {
        sessionId: 'sess',
        host: { changeSchema: z.object({ kind: z.literal('noop') }) } as never,
        ledgerRef: {},
        declined: new Set(),
      },
      // The plan tool: `# Plan mode` renders only with it (and only in a plan-mode run).
      plan: {
        inPlanMode: async () => true,
        present: async () => ({}) as never,
        overview: async () => ({}) as never,
        complete: async () => ({}) as never,
      },
    },
  }),
  // Without them: a section gated on a tool must vanish with it, and its absence is as much
  // a case as its presence.
  bare: createRuntimeToolRegistry({}),
}

/**
 * A channel and the transcript renderer are exclusive: a channel run has no `# Answer
 * formatting`, a transcript run no `# Channel`. Both deliveries are probed.
 */
const deliveries = [{ deliveryContext: { channel: 'slack' } }, {}] as const

function renderWith(
  registry: (typeof registries)['full'],
  delivery: (typeof deliveries)[number],
): string {
  return buildAgentSystemPrompt({
    toolRegistry: registry,
    sessionId: 'sess',
    now: () => '2026-08-20T00:00:00.000Z',
    workspaceRoot: '/repo',
    memoryContext: 'remembered fact',
    scratchDir: '/tmp/scratch',
    projectInstructions: 'follow the rules',
    contextFiles: [{ path: '/repo/AGENTS.md', content: 'rules' }],
    activeSubAgents: [{ title: 'child', task: 'do thing' }],
    loopContext: { loops: [{ id: 'l1', kind: 'fixed', cadence: '* * * * *', prompt: 'tick' }] },
    skillsContext: 'sql-review — review sql',
    pinnedSkills: [{ name: 'sql-review', content: 'review sql carefully' }],
    triggeredSkills: [{ name: 'deploy-guide', content: 'deploy carefully', keyword: 'deploy' }],
    pluginsContext: 'database — 1 skill',
    miniAppsContext: 'chess — 1 direct tool',
    mcpInventory: [{ server: 'acme', tools: ['ticket_search'] }],
    mcpInstructions: [{ server: 'acme', text: 'use tickets' }],
    backgroundJobs: [
      { jobId: 'j1', command: 'bun run build', running: true, startedAt: 0, output: 'ok' },
    ],
    ...delivery,
    sessionTopic: { title: 'Ship it', goal: 'Release is out' },
    // A conversation with a colleague: the turn protocol (stable) and the roster (volatile).
    conversation: { self: 'lead', participants: [{ handle: 'lead' }, { handle: 'qa' }] },
    agentDirectory: [
      {
        id: 'agent-qa',
        handle: 'qa',
        leadershipPriority: 0,
        inConversation: true,
        available: true,
      },
    ],
    reactionContext: '# Reactions since your last turn\n- 👍 on your last message',
    projectStructure: 'src/\npackage.json',
    approvedPlan: { version: 2, title: 'Ship it', body: '# Goal\nShip it.' },
    planMode: { draftPath: '/w/.localix/plans/LOCALIX-1/PLAN.md' },
    outputStyle: { name: 'terse', prompt: 'Keep it short.', keepCodingInstructions: true },
  } as never)
}

/** Every section header seen across all renders, with the side of the marker it landed on. */
function observe(): Map<string, PromptCacheTier | 'inconsistent'> {
  const seen = new Map<string, PromptCacheTier | 'inconsistent'>()
  for (const registry of Object.values(registries))
    for (const delivery of deliveries) {
      const prompt = renderWith(registry, delivery)
      const boundary = prompt.indexOf(RUNTIME_CONTEXT_MARKER)
      expect(boundary).toBeGreaterThan(-1)
      for (const line of prompt.split('\n')) {
        if (!line.startsWith('# ')) continue
        const tier: PromptCacheTier = prompt.indexOf(line) < boundary ? 'stable' : 'volatile'
        const previous = seen.get(line)
        seen.set(line, previous && previous !== tier ? 'inconsistent' : tier)
      }
    }
  return seen
}

describe('the prompt cache boundary', () => {
  test('every section that renders has been classified', () => {
    // The point of the whole file. A new section added above the marker used to ship
    // silently, busting the cached prefix every turn; now it cannot render undeclared.
    const undeclared = [...observe().keys()].filter(
      (header) => !(header in PROMPT_SECTION_CACHE_TIERS),
    )
    expect(undeclared).toEqual([])
  })

  test('each section lands on the side it was declared for', () => {
    const wrong = [...observe()]
      .filter(([header]) => header in PROMPT_SECTION_CACHE_TIERS)
      .filter(([header, tier]) => tier !== PROMPT_SECTION_CACHE_TIERS[header])
      .map(
        ([header, tier]) =>
          `${header}: declared ${PROMPT_SECTION_CACHE_TIERS[header]}, renders ${tier}`,
      )

    expect(wrong).toEqual([])
  })

  test('a section may not land on different sides for different tool sets', () => {
    // `inconsistent` would mean the same header is cacheable with one roster and not another,
    // which no single declaration can describe — the section would need splitting.
    expect([...observe()].filter(([, tier]) => tier === 'inconsistent')).toEqual([])
  })

  test('no declaration is left behind by a deleted section', () => {
    const rendered = new Set(observe().keys())
    expect(Object.keys(PROMPT_SECTION_CACHE_TIERS).filter((h) => !rendered.has(h))).toEqual([])
  })

  test('the probe still reaches most of the prompt', () => {
    // A guard on the guard: the checks above are only worth their cost while the render
    // actually produces sections. Gutting the params would otherwise make them all pass.
    expect(observe().size).toBeGreaterThanOrEqual(Object.keys(PROMPT_SECTION_CACHE_TIERS).length)
  })
})
