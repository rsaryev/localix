import { describe, expect, test } from 'bun:test'
import {
  A8_UI_SLICES,
  C1_WRITES_RECORD_NOTICES,
  C4_CONSUMER_TESTS,
  C6_STORE_WRITERS,
  C7_ROUTE_READINESS,
} from './architecture/flow-rules'
import { loadSources, planted, ratchet, type Rule, type Source } from './architecture/kit'

/**
 * Architecture rules A8, C1, C4, C6 and C7 (`docs/internals/architecture/README.md`) against the
 * repository with their shrinking baselines in `scripts/architecture-baselines/`, each with a
 * positive control proving it still fires and a negative one for the allowed shape. C2, C3 and C5
 * are held by the registry types and review.
 */

const TIMEOUT = 60_000
function enforce(rule: Rule, sources: Source[]) {
  expect(ratchet(rule, rule.detect(sources))).toEqual([])
}

describe('architecture rules against the repository', () => {
  test(
    'A8 UI slices on one layer do not import each other',
    () => enforce(A8_UI_SLICES, loadSources(['apps/ui/src/'])),
    TIMEOUT,
  )
  test(
    'C1 writes to feed entities record their notice',
    () => enforce(C1_WRITES_RECORD_NOTICES, loadSources(['apps/api/src/'])),
    TIMEOUT,
  )
  test(
    'C4 every feed subscription has a consumer test',
    () =>
      enforce(
        C4_CONSUMER_TESTS,
        loadSources(['apps/api/src/', 'packages/', 'plugins/'], { tests: true }),
      ),
    TIMEOUT,
  )
  test(
    'C6 private store writers only in the sync layer',
    () => enforce(C6_STORE_WRITERS, loadSources(['apps/ui/src/'])),
    TIMEOUT,
  )
  test(
    'C7 route readiness is decided once',
    () =>
      enforce(
        C7_ROUTE_READINESS,
        loadSources(['apps/api/src/', 'apps/ui/src/', 'packages/', 'plugins/']),
      ),
    TIMEOUT,
  )
})

describe('positive and negative controls', () => {
  test('A8 fires between slices of one layer, not up the layers or inside a slice', () => {
    expect(
      A8_UI_SLICES.detect([
        planted(
          'apps/ui/src/features/chat/a.ts',
          "import { x } from '@/features/settings/model/x'",
        ),
        planted(
          'apps/ui/src/widgets/w/a.ts',
          "import { x } from '../../features/chat/a'\nimport { y } from '../w/b'",
        ),
      ]),
    ).toEqual(['features/chat -> features/settings'])
  })

  test('C1 fires on an unrecorded write to a feed table', () => {
    const write = "await db.updateTable('agent_sessions').set({ x }).execute()"
    expect(
      C1_WRITES_RECORD_NOTICES.detect([planted('apps/api/src/features/a/x.ts', write)]),
    ).toEqual(['apps/api/src/features/a/x.ts writes agent_sessions'])
    expect(
      C1_WRITES_RECORD_NOTICES.detect([
        planted(
          'apps/api/src/features/a/y.ts',
          'await sql`DELETE FROM agent_messages WHERE id = 1`',
        ),
      ]),
    ).toHaveLength(1)
    expect(
      C1_WRITES_RECORD_NOTICES.detect([
        planted('apps/api/src/features/a/x.ts', `${write}\nawait recordCoreChanges(trx, changes)`),
      ]),
    ).toEqual([])
  })

  test('C4 fires on a subscription with no consumer test', () => {
    const consumer = planted(
      'apps/api/src/bootstrap/c.ts',
      "return deps.feed.subscribe('c', handlers)",
    )
    expect(C4_CONSUMER_TESTS.detect([consumer])).toHaveLength(1)
    expect(
      C4_CONSUMER_TESTS.detect([
        consumer,
        planted('apps/api/src/bootstrap/c.test.ts', "import { c } from './c'"),
      ]),
    ).toEqual([])
    expect(
      C4_CONSUMER_TESTS.detect([
        consumer,
        planted(
          'apps/api/src/bootstrap/d.test.ts',
          "import { fakeFeed } from '@localixai/change-feed/testing'",
        ),
      ]),
    ).toEqual([])
  })

  test('C6 fires on a private writer outside the sync layer', () => {
    const code = 'useChatStore.getState()._replaceSession(session)'
    expect(C6_STORE_WRITERS.detect([planted('apps/ui/src/features/x/y.ts', code)])).toEqual([
      'apps/ui/src/features/x/y.ts -> _replaceSession',
    ])
    expect(
      C6_STORE_WRITERS.detect([planted('apps/ui/src/app/workspaceResourceSync.ts', code)]),
    ).toEqual([])
  })

  test('C7 fires on provider-prefix gating outside the catalog', () => {
    const code = 'return model.startsWith(`${connection.providerId}/`)'
    expect(C7_ROUTE_READINESS.detect([planted('apps/ui/src/features/x/y.ts', code)])).toHaveLength(
      1,
    )
    expect(C7_ROUTE_READINESS.detect([planted('packages/agent/src/catalog/y.ts', code)])).toEqual(
      [],
    )
  })
})
