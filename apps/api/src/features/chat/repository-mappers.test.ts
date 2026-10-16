import { describe, expect, test } from 'bun:test'
import { mapSession, mapMessage, toSessionSummary } from './repository-mappers'
import { serializeMessagePayload } from '../../db/payload'

describe('mapMessage', () => {
  const row = () => ({
    id: 'm1',
    session_id: 's1',
    user_id: 'u1',
    // Through the codec, like every production writer: a hand-rolled JSON.stringify skips
    // the format stamp the reader requires.
    payload_json: serializeMessagePayload({
      id: 'm1',
      role: 'assistant',
      content: 'hi',
      contextBoundary: true,
      compactedUpToId: 'm0',
    } as never),
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-02 00:00:00',
  })

  test('renames snake_case columns to the camelCase PersistedMessage shape', () => {
    const m = mapMessage(row())
    expect(m).toMatchObject({
      id: 'm1',
      sessionId: 's1',
      userId: 'u1',
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-02 00:00:00',
    })
  })

  test('deserializes payload_json into the payload object (special fields survive)', () => {
    const m = mapMessage(row())
    expect(m.payload).toMatchObject({
      id: 'm1',
      role: 'assistant',
      content: 'hi',
      contextBoundary: true,
      compactedUpToId: 'm0',
    })
  })
})

// Minimal valid row; tests override only the field under test.
const baseRow = () => ({
  id: 's1',
  user_id: 'u1',
  title: 'T',
  is_pinned: 0,
  created_at: 'c',
  updated_at: 'u',
  last_message_at: 'l',
  execution_backend: 'local',
  execution_target: null,
  project_id: 'PRJ-test',
  parent_session_id: null,
  root_session_id: null,
  session_kind: 'chat' as const,
  runtime_status: 'idle' as const,
  source_tool_call_id: null,
  invocation_json: '{"kind":"root"}',
})

describe('mapSession', () => {
  test('coerces SQLite integer flags to booleans', () => {
    expect(mapSession({ ...baseRow(), is_pinned: 1 }).isPinned).toBe(true)
    expect(mapSession({ ...baseRow(), is_pinned: 0 }).isPinned).toBe(false)
  })

  test('parses valid provenance and rejects unknown payloads loudly', () => {
    expect(
      mapSession({
        ...baseRow(),
        invocation_json:
          '{"kind":"task-delegation","parentSessionId":"parent","toolCallId":"tool-1"}',
      }).provenance,
    ).toEqual({
      kind: 'task-delegation',
      parentSessionId: 'parent',
      toolCallId: 'tool-1',
    })
    expect(
      mapSession({ ...baseRow(), invocation_json: '{"kind":"unknown-origin"}' }).provenance,
    ).toEqual({ kind: 'unknown-origin' })
    // 20260818T010002 normalized every stored row, so an unparseable payload can only
    // be a code bug — the read must halt, not silently demote the session.
    expect(() => mapSession({ ...baseRow(), invocation_json: 'not json' })).toThrow(
      'Unrecognized session provenance',
    )
    expect(() => mapSession({ ...baseRow(), invocation_json: '{"kind":"old-worker"}' })).toThrow(
      'Unrecognized session provenance',
    )
  })

  test('applies default fallbacks for nullable/missing columns', () => {
    const r = mapSession({ ...baseRow(), root_session_id: null })
    expect(r.rootSessionId).toBe('s1') // falls back to the session id
  })

  test('keeps a real root_session_id when present', () => {
    expect(mapSession({ ...baseRow(), root_session_id: 'root-9' }).rootSessionId).toBe('root-9')
  })

  test('parsePinnedSkills: valid array, non-array, bad JSON, null all behave', () => {
    expect(mapSession({ ...baseRow(), pinned_skills: '["a","b"]' }).pinnedSkills).toEqual([
      'a',
      'b',
    ])
    expect(mapSession({ ...baseRow(), pinned_skills: '["a",2,null]' }).pinnedSkills).toEqual(['a']) // non-strings filtered
    expect(mapSession({ ...baseRow(), pinned_skills: '{"x":1}' }).pinnedSkills).toEqual([]) // not an array
    expect(mapSession({ ...baseRow(), pinned_skills: 'not json' }).pinnedSkills).toEqual([]) // parse error
    expect(mapSession({ ...baseRow(), pinned_skills: null }).pinnedSkills).toEqual([])
    expect(mapSession({ ...baseRow() }).pinnedSkills).toEqual([]) // missing
  })

  test('activated tools survive the round trip and fail closed when malformed', () => {
    // The order is the ACTIVATION order and has to be preserved: the tools list is a cached prompt
    // prefix, and re-sorting it on a later turn throws that cache away.
    expect(
      mapSession({ ...baseRow(), activated_tools: '["catalog_query","github_create_issue"]' })
        .activatedTools,
    ).toEqual(['catalog_query', 'github_create_issue'])
    expect(mapSession({ ...baseRow(), activated_tools: 'not json' }).activatedTools).toEqual([])
    expect(mapSession({ ...baseRow(), activated_tools: null }).activatedTools).toEqual([])
    expect(mapSession({ ...baseRow() }).activatedTools).toEqual([])
  })
})

test('external CLI metadata is preserved by both the record and the ordinary session summary', () => {
  const session = mapSession({
    ...baseRow(),
    external_agent_provider: 'codex',
    external_agent_session_key: 'codex:native',
  })
  expect(session).toMatchObject({
    externalAgentProvider: 'codex',
    externalAgentSessionKey: 'codex:native',
  })
  expect(toSessionSummary(session)).toMatchObject({
    externalAgentProvider: 'codex',
    externalAgentSessionKey: 'codex:native',
  })
})
