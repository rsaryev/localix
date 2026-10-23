import type { SessionAgentRoute, SessionRecord } from '../features/chat/repository-types'
import { DEFAULT_AGENT_HANDLE } from '../db/participant'
import { builtinAgentId } from '@localixai/agent/agents'

const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00.000Z'

/**
 * A complete {@link SessionRecord}, for a test that needs one to exist rather than to be
 * interesting.
 *
 * Every field is spelled out here ONCE. It used to be spelled out in each test that needed a
 * session — thirty-odd properties, hand-copied into two dozen files — and the arithmetic of that
 * is what this replaces: a field added to the record broke every one of those literals at the same
 * time, and the breakage was invisible, because `type-check:tests` is not part of `bun run test`.
 * `activatedTools` did exactly that, and nine files sat red until someone ran the other command.
 *
 * The same reasoning as `recordingMiniAppUiHost` on the UI side: when a contract grows, the thing
 * that has to learn about it should be the one file that owns the shape, not every caller.
 *
 * `overrides` is what a test actually says. Pass only the fields the case is about — the id, the
 * parent, the kind — and let the rest be uninteresting-but-valid.
 */
/**
 * One participant on a stated route — what a test means by "this session runs on model X".
 *
 * Spelled here rather than inline at each test because a model belongs to a participant, so
 * the literal is four fields deep and would otherwise be retyped at every case that pins one.
 */
export function routedParticipants(
  route: Partial<SessionAgentRoute> = {},
): [SessionAgentRoute, ...SessionAgentRoute[]] {
  return [
    {
      agentId: builtinAgentId(route.handle ?? DEFAULT_AGENT_HANDLE),
      handle: DEFAULT_AGENT_HANDLE,
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
      ...route,
    },
  ]
}

export function sessionFixture(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const id = overrides.id ?? 'session-1'
  return {
    id,
    userId: 'user-1',
    seq: 1,
    title: id,
    goal: null,
    previousTopicSummary: null,
    isPinned: false,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    lastMessageAt: FIXTURE_TIMESTAMP,
    executionBackend: 'local',
    executionTarget: null,
    // A fixture project, not the real default one: a session record always carries a project
    // (its capability scope is keyed by it), and a test must not have to create a directory on
    // disk to build one.
    projectId: 'PRJ-fixture',
    parentSessionId: null,
    // A root session is its own root — the same default `mapSession` applies when the column is
    // null, so a fixture that omits it still behaves like a real row.
    rootSessionId: id,
    sessionKind: 'chat',
    agents: routedParticipants(),
    description: null,
    avatar: null,
    runtimeStatus: 'idle',
    sourceToolCallId: null,
    provenance: { kind: 'root' },
    pinnedSkills: [],
    activatedTools: [],
    archivedAt: null,
    ...overrides,
  }
}
