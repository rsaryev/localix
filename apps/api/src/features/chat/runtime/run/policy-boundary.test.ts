/**
 * A RUN DECIDES FROM ITS POLICY, never from the session record again.
 *
 * Every question a run asks of its context — which host it is, whether colleagues share the
 * conversation, who leads, whether a person can answer — is an axis of `chat/policy`, resolved
 * once per run (`stages/policy.ts`). The questions used to be asked inline, in up to five
 * spellings per question that disagreed at the edges; this lint keeps them from coming back.
 *
 * A match that is not a decision about THIS run — a filter over other sessions, the source of a
 * fact the policy reads — is exempted with its reason, and an exemption that stops matching
 * goes stale (RED), so the list cannot outlive what it blesses.
 */
import { describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'

import {
  assertNotVoid,
  assertPositiveControl,
  auditExemptions,
  exemptionKey,
  scanSources,
  staleReport,
  type Exemptions,
} from '../../../../lib/source-lint'

const RUN_DIR = dirname(Bun.fileURLToPath(import.meta.url))

/** The inline shapes of a policy question. Each is a decision some axis owns. */
const DETECTORS: readonly { idiom: string; pattern: RegExp }[] = [
  { idiom: 'sessionKind comparison', pattern: /\bsessionKind\s*[!=]==/g },
  { idiom: 'participant count', pattern: /\bisMultiParticipant\(|\bagents\.length\s*[<>=!]/g },
  { idiom: 'leader election', pattern: /\bconversationLeader\(/g },
  { idiom: 'permission mode comparison', pattern: /\bpermissionMode\s*[!=]==/g },
]

const EXEMPTIONS: Exemptions = {
  [exemptionKey('hitl-reachable.ts', 'sessionKind comparison')]: {
    reason:
      'The route to a person IS the fact the human axis reads: a job targeting itself and a non-chat root render no card.',
  },
  [exemptionKey('descendant-roster.ts', 'sessionKind comparison')]: {
    reason: 'Filters the OTHER sessions of the tree down to delegated children for the roster.',
  },
  [exemptionKey('system-prompt-build.ts', 'sessionKind comparison')]: {
    reason: 'Filters the in-memory child map to sub-agents of this session, not this run.',
  },
  [exemptionKey('conversation-membership.ts', 'participant count')]: {
    reason: 'Validates the membership write itself: a conversation keeps at least one participant.',
  },
  [exemptionKey('session-topic.ts', 'leader election')]: {
    reason:
      'set_topic re-checks the leader against the registry AT CALL TIME: a stronger colleague may have joined since the run elected its seat.',
  },
}

async function inlineDecisions(root: string): Promise<string[]> {
  const sources = await scanSources({
    root,
    include: ['**/*.ts'],
    skip: (file) => file.endsWith('.test.ts'),
    minFiles: 1,
  })
  return sources.flatMap((source) =>
    DETECTORS.filter((detector) => new RegExp(detector.pattern).test(source.code)).map((detector) =>
      exemptionKey(source.file.split('/').pop()!, detector.idiom),
    ),
  )
}

describe('the run reads its policy', () => {
  test('no stage or run module decides inline what an axis decides', async () => {
    const audit = auditExemptions(EXEMPTIONS, await inlineDecisions(RUN_DIR))
    expect(audit.offenders).toEqual([])
    if (audit.stale.length) throw new Error(staleReport(audit.stale))
  })

  test('the walk reaches the run modules it polices', async () => {
    const sources = await scanSources({ root: RUN_DIR, include: ['**/*.ts'], minFiles: 40 })
    assertNotVoid(
      'run modules that read the policy',
      sources.filter((source) =>
        /\bpolicy\.(conversation|seat|human|host|lineage)\b/.test(source.code),
      ).length,
      'the stages read `turn.policy`; zero readers means the tree moved, not that it got cleaner.',
    )
  })

  test('positive control — an inline participant count is caught, planted on disk', async () => {
    await assertPositiveControl({
      subject: 'a run module deciding the room from the participant count',
      file: 'nested-probe/leaky.ts',
      offender:
        'export const multi = (session: { agents: unknown[] }) => session.agents.length > 1\n',
      detect: inlineDecisions,
      scaffold: {
        'clean.ts': 'export const room = (policy: { withColleagues: boolean }) => policy\n',
      },
    })
  })
})
