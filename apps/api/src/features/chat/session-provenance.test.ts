import { describe, expect, test } from 'bun:test'

import { createSessionRequestSchema, updateSessionRequestSchema } from './contracts'
import {
  PREVIOUS_TOPIC_SUMMARY_MAX_CHARS,
  SESSION_GOAL_MAX_CHARS,
} from '../agent-core/session-topic'
import { SESSION_TITLE_MAX_CHARS } from './session-limits'
import { MODEL_ID_MAX_CHARS, PROVIDER_CONNECTION_ID_MAX_CHARS } from '../catalog/model-identity'
import {
  parseSessionProvenance,
  serializeSessionProvenance,
  sessionExecutionClass,
  sessionTopology,
  type SessionProvenance,
} from './session-provenance'

const cases: Array<
  [SessionProvenance, 'root' | 'child', 'interactive' | 'isolated-worker' | 'passive']
> = [
  [{ kind: 'root' }, 'root', 'interactive'],
  [
    {
      kind: 'task-delegation',
      parentSessionId: 'p',
      toolCallId: 'tool',
      parentParticipant: 'lead',
    },
    'child',
    'isolated-worker',
  ],
  [{ kind: 'loop', parentSessionId: 'p', loopId: 'loop' }, 'child', 'isolated-worker'],
  [{ kind: 'hook', parentSessionId: 'p', phase: 'verifier' }, 'child', 'isolated-worker'],
  [{ kind: 'skill-fork', parentSessionId: 'p' }, 'child', 'isolated-worker'],
  [{ kind: 'thread', parentSessionId: 'p', phase: 'message' }, 'child', 'interactive'],
  [{ kind: 'fork', parentSessionId: 'p' }, 'child', 'interactive'],
  [
    { kind: 'external-agent', parentSessionId: 'p', toolCallId: 'tool' },
    'child',
    'isolated-worker',
  ],
  [{ kind: 'unknown-origin' }, 'child', 'passive'],
]

describe('session provenance', () => {
  test('round-trips every discriminator and derives topology/execution centrally', () => {
    for (const [provenance, topology, executionClass] of cases) {
      expect(parseSessionProvenance(serializeSessionProvenance(provenance))).toEqual(provenance)
      expect(sessionTopology(provenance)).toBe(topology)
      expect(sessionExecutionClass(provenance)).toBe(executionClass)
    }
  })

  test('bad, partial, and unknown JSON throw instead of silently degrading', () => {
    // Post-20260818T010002 these shapes cannot exist in the database (see
    // normalize-session-provenance.test.ts), so encountering one is a code bug
    // and the parser halts the read rather than demoting the session.
    for (const raw of [
      '',
      'nope',
      '{}',
      '{"kind":"worker"}',
      '{"kind":"root","parentSessionId":"forged-child"}',
      '{"kind":"old"}',
      '{"kind":"legacy-unknown"}', // the pre-migration spelling is itself unknown now
      '{"kind":"unknown-origin","extra":"forged"}',
      // A role label was a second identity next to the participant's AgentId, and no writer
      // produces it: accepting it would let a stale label ride along unseen.
      '{"kind":"task-delegation","parentSessionId":"p","toolCallId":"t","roleId":"r"}',
      '{"kind":"skill-fork","parentSessionId":"p","roleId":"r"}',
      // A board card id is the task-board plugin's knowledge, not core's; the
      // 20260926T000000 migration strips it from stored rows, so one that survives is a bug.
      '{"kind":"task-delegation","parentSessionId":"p","toolCallId":"t","kanbanTaskId":"K"}',
    ]) {
      expect(() => parseSessionProvenance(raw)).toThrow('Unrecognized session provenance')
    }
  })
})

describe('public create-session contract', () => {
  test('shared topic fields are bounded, normalized and can be explicitly cleared', () => {
    for (const schema of [createSessionRequestSchema, updateSessionRequestSchema]) {
      expect(
        schema.parse({ goal: ' Ship it. ', previousTopicSummary: ' Keep Bun. ' }),
      ).toMatchObject({
        goal: 'Ship it.',
        previousTopicSummary: 'Keep Bun.',
      })
      expect(schema.parse({ goal: null, previousTopicSummary: null })).toMatchObject({
        goal: null,
        previousTopicSummary: null,
      })
      for (const [field, max] of [
        ['goal', SESSION_GOAL_MAX_CHARS],
        ['previousTopicSummary', PREVIOUS_TOPIC_SUMMARY_MAX_CHARS],
      ] as const) {
        expect(schema.safeParse({ [field]: ' ' }).success).toBe(false)
        expect(schema.safeParse({ [field]: 'x'.repeat(max) }).success).toBe(true)
        expect(schema.safeParse({ [field]: 'x'.repeat(max + 1) }).success).toBe(false)
      }
    }
  })
  test('accepts root chat metadata only', () => {
    expect(createSessionRequestSchema.parse({ title: 'Chat', projectId: null })).toEqual({
      title: 'Chat',
      projectId: null,
    })
  })

  test('strictly rejects lineage/provenance fields instead of silently stripping them', () => {
    for (const forged of [
      { parentSessionId: 'p' },
      { rootSessionId: 'r' },
      { sessionKind: 'subagent' },
      { sourceToolCallId: 'tool' },
      { provenance: { kind: 'root' } },
    ]) {
      expect(createSessionRequestSchema.safeParse(forged).success).toBe(false)
    }
  })

  test('normalizes ordinary titles and rejects prompt-inflating ones', () => {
    expect(createSessionRequestSchema.parse({ title: '  Audit   runtime  ' }).title).toBe(
      'Audit   runtime',
    )
    expect(
      createSessionRequestSchema.safeParse({ title: 'x'.repeat(SESSION_TITLE_MAX_CHARS + 1) })
        .success,
    ).toBe(false)
    expect(createSessionRequestSchema.safeParse({ title: '   ' }).success).toBe(false)
  })

  test('rejects empty or oversized persisted model identities', () => {
    for (const [field, max] of [
      ['modelId', MODEL_ID_MAX_CHARS],
      ['providerConnectionId', PROVIDER_CONNECTION_ID_MAX_CHARS],
    ] as const) {
      expect(createSessionRequestSchema.safeParse({ [field]: '' }).success).toBe(false)
      expect(createSessionRequestSchema.safeParse({ [field]: 'x'.repeat(max) }).success).toBe(true)
      expect(createSessionRequestSchema.safeParse({ [field]: 'x'.repeat(max + 1) }).success).toBe(
        false,
      )
    }
    expect(createSessionRequestSchema.safeParse({ providerConnectionId: null }).success).toBe(true)
  })
})
