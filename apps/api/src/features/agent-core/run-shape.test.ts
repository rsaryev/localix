import { describe, expect, test } from 'bun:test'
import {
  CHAT_RUN_PROFILE,
  gathersMcpTools,
  hasToolFeature,
  isToolDirect,
  resolveRunProfile,
  runShapeOf,
  toolExposure,
  type RunShape,
} from './run-shape'
import { BUILTIN_TOOL_NAMES, TOOL } from './tool-names'

/**
 * The built-in vocabulary, TYPED (`BUILTIN_TOOL_NAMES` is the widened `string[]` view —
 * plugin validation tests arbitrary names against it, so it cannot be narrowed).
 * `isToolDirect` takes a `ToolName`, so the lint below must scan the typed set.
 */
const BUILTIN_TOOLS = Object.values(TOOL)

/** The three shapes, reached the way production reaches them: through a session kind. */
const child = (tools?: string[], prompt?: string) =>
  resolveRunProfile({ sessionKind: 'subagent' }, tools || prompt ? { tools, prompt } : null)
const job = (tools?: string[], prompt?: string) =>
  resolveRunProfile({ sessionKind: 'job' }, tools || prompt ? { tools, prompt } : null)
const SHAPES: RunShape[] = ['chat', 'subagent', 'automation']
const profileOf = (shape: RunShape) =>
  resolveRunProfile({
    sessionKind: shape === 'chat' ? 'chat' : shape === 'subagent' ? 'subagent' : 'job',
  })

describe('toolExposure', () => {
  test.each(['subagent', 'job'] as const)(
    'an empty %s roster does not restore default tools',
    (sessionKind) => {
      const empty = resolveRunProfile({ sessionKind }, { tools: [] })
      for (const name of BUILTIN_TOOLS) {
        expect(isToolDirect(empty, name)).toBe(name === TOOL.tool_output)
      }
      const inherited = resolveRunProfile({ sessionKind })
      expect(isToolDirect(inherited, TOOL.bash)).toBe(true)
      expect(isToolDirect(inherited, TOOL.read)).toBe(true)
    },
  )

  test('defaults to "hidden" for a tool not in the profile map', () => {
    const p = child(['read'])
    expect(toolExposure(p, 'read')).toBe('direct')
    expect(toolExposure(p, 'definitely_not_a_tool')).toBe('hidden')
  })
})

describe('runShapeOf', () => {
  test('maps every session kind onto one of the three shapes', () => {
    expect(runShapeOf('chat')).toBe('chat')
    expect(runShapeOf('subagent')).toBe('subagent')
    // Job-kind sessions run agent loops (scheduler and loop fires) and need a real
    // toolset; a `system` thread never invokes the model and gets the same locked shape.
    expect(runShapeOf('job')).toBe('automation')
    expect(runShapeOf('system')).toBe('automation')
  })
})

describe('an agent dispatched into a run', () => {
  test("its declared tools are the unattended run's surface, closed, with no background bash", () => {
    const p = child(['read', 'write'])
    expect(p.shape).toBe('subagent')
    // A declared list CLOSES the toolset: plugin/MCP tools must not leak into a scoped
    // agent (they bloat its per-turn prefill and dilute focus).
    expect(p.openToolset).toBe(false)
    expect(isToolDirect(p, 'read')).toBe(true)
    expect(isToolDirect(p, 'write')).toBe(true)
    expect(hasToolFeature(p, 'bash', 'background')).toBe(false)
    expect(hasToolFeature(p, 'bash', 'notify')).toBe(false)
  })

  test("its prompt is the run's identity, whichever host dispatched it", () => {
    expect(child(['read'], 'You are a linter.').prompt.identity).toBe('You are a linter.')
    // The SAME record, dispatched as an unattended job instead of a delegation, introduces itself
    // identically — the two used to run through separate builders with separate identities.
    expect(job(['read'], 'You are a linter.').prompt.identity).toBe('You are a linter.')
  })

  test('an agent that declares nothing gets its shape floor', () => {
    const p = child()
    expect(Object.keys(p.toolExposure).length).toBeGreaterThan(0)
    // The default child cannot spawn children: the absence of the tool is what bounds
    // the session tree, so this is the assertion standing in for a depth limit.
    expect(isToolDirect(p, 'ask')).toBe(false)
    // No declaration → still CLOSED: an unattended worker's schema payload must not scale
    // with the user's connected MCP servers.
    expect(p.openToolset).toBe(false)
  })

  test('it cannot re-introduce user-blocking question tools in an unattended run', () => {
    for (const p of [child(['read', 'ask']), job(['read', 'ask'])]) {
      expect(isToolDirect(p, 'read')).toBe(true)
      expect(isToolDirect(p, 'ask')).toBe(false)
    }
  })

  test('a chat keeps its full surface — the record narrows a chat through its capability scope', () => {
    // Enforcing the declared list from the run surface too would silently overrule the
    // Capabilities screen, whose rows the user owns after the one-time preset seed.
    const p = resolveRunProfile({ sessionKind: 'chat' }, { tools: ['read'], prompt: 'You lead.' })
    expect(isToolDirect(p, 'write')).toBe(true)
    expect(p.openToolset).toBe(true)
    // The identity still comes from the record.
    expect(p.prompt.identity).toBe('You lead.')
  })
})

describe('a child that inherits the conversation’s tools', () => {
  const inheriting = (sessionKind: 'subagent' | 'job', tools?: string[]) =>
    resolveRunProfile({ sessionKind }, { inheritsConversationTools: true, tools })

  test('opens its toolset to MCP and keeps its own shape’s built-ins', () => {
    const p = inheriting('subagent')
    expect(p.openToolset).toBe(true)
    expect(p.inheritsConversation).toBe(true)
    expect(isToolDirect(p, 'read')).toBe(true)
    expect(isToolDirect(p, 'mcp_resources')).toBe(true)
    // Still a child: it cannot ask the person or delegate again.
    for (const name of ['ask', 'delegate', 'configure'] as const)
      expect(isToolDirect(p, name)).toBe(false)
    expect(gathersMcpTools(p)).toBe(true)
  })

  test('only a subagent without a tools list inherits; a list or another shape stays closed', () => {
    for (const p of [inheriting('subagent', ['read']), inheriting('job')]) {
      expect(p.openToolset).toBe(false)
      expect(p.inheritsConversation).toBeUndefined()
    }
    expect(isToolDirect(child(), 'mcp_resources')).toBe(false)
  })

  test('a closed list gathers MCP servers only when it names an MCP tool', () => {
    expect(gathersMcpTools(child(['read']))).toBe(false)
    expect(gathersMcpTools(child(['read', 'mcp_p_ctl_echo']))).toBe(true)
    expect(gathersMcpTools(child(['read', 'mcp__srv__*']))).toBe(true)
  })
})

describe('run shapes', () => {
  test('uses tool exposure instead of per-capability booleans', () => {
    expect(isToolDirect(CHAT_RUN_PROFILE, 'delegate')).toBe(true)
    expect(isToolDirect(CHAT_RUN_PROFILE, 'jobs')).toBe(true)
    expect(isToolDirect(CHAT_RUN_PROFILE, 'browser')).toBe(true)

    const sub = profileOf('subagent')
    // Subsessions cannot fork even through an explicit agent tool list.
    expect(isToolDirect(sub, 'delegate')).toBe(false)
    expect(isToolDirect(child(['delegate']), 'delegate')).toBe(false)
    expect(isToolDirect(profileOf('automation'), 'delegate')).toBe(false)
    // Registry authoring belongs to a chat; a child never creates agents.
    expect(isToolDirect(CHAT_RUN_PROFILE, 'agents')).toBe(true)
    expect(isToolDirect(sub, 'agents')).toBe(false)
    expect(isToolDirect(sub, 'jobs')).toBe(false)
    expect(isToolDirect(sub, 'browser')).toBe(true)
    expect(isToolDirect(sub, 'ask')).toBe(false)
    // `bash` IS exposed (see the shell test below) but `jobs` is not: the child cannot
    // start a background process, so it has nothing to manage.
  })

  // General guard against the whole dead-code class: a tool in the TOOL enum but absent
  // from EVERY shape's surface is registered yet invisible (isToolDirect=false everywhere).
  // This catches any future tool that skips the surface step, not just the DB ones.
  test('every built-in tool name is exposed by at least one shape (no orphan/dead-code tools)', () => {
    // SCAN LIVENESS. `orphans` empty is the GOAL state, so "found nothing" is never
    // evidence on its own: the corpus is DERIVED (`Object.values(TOOL)`), and emptying
    // TOOL left this test at 1 expect / 0 fail while scanning zero tools
    // (mutation-verified). Assert the corpus before trusting the verdict.
    expect(BUILTIN_TOOLS.length).toBeGreaterThan(20)
    const orphans = BUILTIN_TOOLS.filter(
      (name) => !SHAPES.some((shape) => isToolDirect(profileOf(shape), name)),
    )
    expect(orphans).toEqual([])
  })

  test('keeps background bash in a chat, denies it to synchronous children', () => {
    expect(hasToolFeature(CHAT_RUN_PROFILE, 'bash', 'background')).toBe(true)
    expect(hasToolFeature(profileOf('subagent'), 'bash', 'background')).toBe(false)
    expect(hasToolFeature(profileOf('subagent'), 'bash', 'notify')).toBe(false)
  })

  test('a sub-agent has a shell — it must be able to verify what it changed', () => {
    // Without bash the child edits code it cannot type-check or test, and the parent
    // re-reads the files delegation was supposed to keep out of its context.
    expect(isToolDirect(profileOf('subagent'), 'bash')).toBe(true)
    // …but a synchronous child must not leave a background job behind it.
    expect(hasToolFeature(profileOf('subagent'), 'bash', 'background')).toBe(false)
  })
})

describe('elision recovery is reachable from every compressed run', () => {
  // Every run's wire goes through the same context compression, and an elided tool
  // result advertises `tool_output(action="get", tool_call_id="…")`. A run that receives
  // those pointers without the tool has a dead recovery path: it can only re-read the
  // whole file (re-billing it) or waste a turn on a not_found error. Measured across
  // 30 recent sessions: 48% of all `read` calls were redundant re-reads and
  // `tool_output` was called exactly once in 1638 tool calls.
  for (const shape of SHAPES) {
    test(`${shape} exposes tool_output`, () => {
      expect(isToolDirect(profileOf(shape), 'tool_output')).toBe(true)
    })
  }

  test('a dispatched agent keeps tool_output — with a default OR a declared tool list', () => {
    expect(isToolDirect(child(), 'tool_output')).toBe(true)
    // The bug: an agent that declares its own tools replaced the defaults wholesale and
    // lost the recovery tool while still receiving its pointers.
    for (const custom of [child(['read', 'search']), job(['read', 'search'])]) {
      expect(isToolDirect(custom, 'tool_output')).toBe(true)
      expect(isToolDirect(custom, 'write')).toBe(false) // no authority was widened
    }
  })
})

/**
 * `prompt.roleGuidance` is STATIC: it is emitted for every run of that shape, whatever the
 * tool registry ended up holding. Naming a tool there is the capability-overclaim defect
 * `prompt/capability.test.ts` guards — except that test renders the goldens, and a
 * golden can only show one registry. Sub-agent guidance must not describe the chat's
 * `fork` tool; an unattended run may not hold `jobs` at all.
 *
 * Tool-conditional guidance belongs in a `prompt/sections/` section, behind a `has(TOOL.x)`.
 */
describe('roleGuidance never names a tool', () => {
  const NAMES = BUILTIN_TOOL_NAMES.filter((n) => n.length > 4) // 'ask' is also an English word

  /** A shape's roleGuidance, as the lint reads it. */
  const guidanceOf = (shape: RunShape) => profileOf(shape).prompt.roleGuidance.join(' ')

  /** Tool names a shape's STATIC roleGuidance is blessed to backtick, with the reason. */
  const namesToolIn = (text: string) => NAMES.filter((n) => text.includes(`\`${n}\``))

  /**
   * EMPTY, and that is the point.
   *
   * `automation` used to be blessed for the task-board tool ("its engine dispatches the run,
   * which guarantees the tool"). The blessing was INERT: this lint only sees a BACKTICKED
   * name, and automation's roleGuidance named that tool without backticks, so the exception
   * could never fire. An allowance that cannot be exercised
   * is not free: it is a standing permission to backtick a conditional tool in static
   * prose, which is exactly what this lint exists to reject, sitting there pre-approved.
   *
   * Removed. If a future edit genuinely needs to backtick a tool here, THIS TEST GOING RED
   * is the right moment to re-add the entry with a fresh, live reason — which is how an
   * allowlist is supposed to be earned.
   *
   * KNOWN LIMIT (reported, not silently widened): an UN-backticked mention is invisible to
   * this lint. Widening it would flag "Use bash/read/search/file tools directly", which is
   * both idiomatic and harmless — those are core tools present in EVERY registry, while the
   * bug this guards is a CONDITIONAL tool promised unconditionally.
   */
  const ALLOWED: Partial<Record<RunShape, string[]>> = {}

  // SCAN LIVENESS, on BOTH axes this lint depends on: the shapes it registers a test per
  // (an empty list registers zero tests, and a suite with no tests is green) and the
  // vocabulary it matches with (NAMES is derived from BUILTIN_TOOL_NAMES; empty → every
  // shape trivially "names no tool"). The positive control below proves the DETECTOR
  // fires; this proves it was pointed at something.
  test('the lint has a corpus and a vocabulary', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(15)
  })

  for (const shape of SHAPES) {
    test(shape, () => {
      const allowed = ALLOWED[shape] ?? []
      expect(namesToolIn(guidanceOf(shape)).filter((n) => !allowed.includes(n))).toEqual([])
    })
  }

  // Every shape's roleGuidance is currently clean, so "found no tool name" is the GOAL
  // state — which means it can never prove the detector still works. Prove it on a sample.
  test('the detector still fires — positive control', () => {
    // The sample names catalogued tools: a name outside BUILTIN_TOOL_NAMES would match nothing
    // and leave this control passing on an empty result.
    expect(namesToolIn('Use the `memory` tool, then `browser` to verify.')).toEqual(
      NAMES.filter((n) => n === 'memory' || n === 'browser'),
    )
    expect(NAMES.filter((n) => n === 'memory' || n === 'browser')).toHaveLength(2)
    expect(namesToolIn('Use bash and read directly for the work.')).toEqual([])
  })

  test('the allowlist has no stale entries — a blessing outlives nothing', () => {
    const stale = Object.entries(ALLOWED).flatMap(([shape, tools]) =>
      (tools ?? [])
        .filter((t) => !guidanceOf(shape as RunShape).includes(`\`${t}\``))
        .map((t) => `${shape} is blessed for \`${t}\` but no longer names it`),
    )
    expect(stale).toEqual([])
  })
})
