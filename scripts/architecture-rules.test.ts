import { describe, expect, test } from 'bun:test'
import {
  A4_COMPOSITION_ROOT,
  A5_KYSELY_IN_REPOSITORIES,
  A6_FEATURE_CYCLES,
  A7_HTTP_ERRORS_IN_ROUTES,
} from './architecture/api-rules'
import { loadSources, planted, ratchet, type Rule, type Source } from './architecture/kit'
import {
  A1_PACKAGE_CYCLES,
  A2_AGNOSTIC_CORE,
  A3_PROVIDER_SDK_HOME,
  loadManifests,
} from './architecture/package-rules'

/**
 * Architecture rules A1–A7 (`docs/internals/architecture/README.md`), each against the repository
 * with its shrinking baseline in `scripts/architecture-baselines/`, and each with a positive
 * control proving it still fires and a negative one proving it does not fire on the allowed shape.
 * The rest of A1 (no package imports apps, `@/` or a plugin) is `scripts/check-architecture.mjs`.
 */

const TIMEOUT = 60_000
let cached: Source[] | undefined
const repo = () =>
  (cached ??= loadSources([
    'apps/api/src/',
    'apps/api/migrations/',
    'apps/ui/src/',
    'packages/',
    'plugins/',
  ]))

function enforce(rule: Rule, sources: Source[]) {
  expect(ratchet(rule, rule.detect(sources))).toEqual([])
}

describe('architecture rules against the repository', () => {
  test('A1 no cycle between workspace packages', () => enforce(A1_PACKAGE_CYCLES, loadManifests()))
  test(
    'A2 the core imports no framework, store, IO or provider SDK',
    () => enforce(A2_AGNOSTIC_CORE, repo()),
    TIMEOUT,
  )
  test(
    'A3 provider SDKs only in engine-models',
    () => enforce(A3_PROVIDER_SDK_HOME, repo()),
    TIMEOUT,
  )
  test(
    'A4 only bootstrap constructs another feature',
    () => enforce(A4_COMPOSITION_ROOT, repo()),
    TIMEOUT,
  )
  test('A5 kysely only in repositories', () => enforce(A5_KYSELY_IN_REPOSITORIES, repo()), TIMEOUT)
  test(
    'A6 no value-import cycle between API features',
    () => enforce(A6_FEATURE_CYCLES, repo()),
    TIMEOUT,
  )
  test('A7 HTTP errors only in routes', () => enforce(A7_HTTP_ERRORS_IN_ROUTES, repo()), TIMEOUT)
})

const manifest = (name: string, deps: string[]) =>
  planted(
    `packages/${name}/package.json`,
    JSON.stringify({
      name,
      dependencies: Object.fromEntries(deps.map((dep) => [dep, 'workspace:*'])),
    }),
  )

describe('positive and negative controls', () => {
  test('A1 fires on a package cycle, not on a chain', () => {
    expect(A1_PACKAGE_CYCLES.detect([manifest('a', ['b']), manifest('b', ['a'])])).toEqual([
      'package cycle a -> b',
      'package cycle b -> a',
    ])
    expect(A1_PACKAGE_CYCLES.detect([manifest('a', ['b']), manifest('b', [])])).toEqual([])
  })

  test('A2 fires on React, node:*, a bare built-in and an SDK in the core', () => {
    const hits = A2_AGNOSTIC_CORE.detect([
      planted('packages/agent/src/x.ts', "import React from 'react'\nimport 'node:fs'"),
      planted(
        'packages/engine-loop/src/y.ts',
        "import { readFile } from 'fs'\nimport { streamText } from 'ai'",
      ),
      planted('packages/kit/src/z.ts', "import React from 'react'"),
    ])
    expect(hits).toHaveLength(4)
    expect(hits.join('\n')).not.toContain('packages/kit')
  })

  test('A3 fires outside engine-models only', () => {
    expect(
      A3_PROVIDER_SDK_HOME.detect([
        planted(
          'apps/api/src/x.ts',
          "import { createOpenRouter } from '@openrouter/ai-sdk-provider'",
        ),
        planted('packages/engine-models/src/y.ts', "import { anthropic } from '@ai-sdk/anthropic'"),
      ]),
    ).toEqual(['apps/api/src/x.ts imports @openrouter/ai-sdk-provider'])
  })

  test('A4 fires when a feature constructs another feature', () => {
    const code =
      "import { createUsageRepository } from '../usage/repository'\nconst r = createUsageRepository(db)"
    expect(A4_COMPOSITION_ROOT.detect([planted('apps/api/src/features/chat/x.ts', code)])).toEqual([
      'apps/api/src/features/chat/x.ts calls createUsageRepository (usage)',
    ])
    expect(
      A4_COMPOSITION_ROOT.detect([
        planted('apps/api/src/features/usage/x.ts', code.replace('../usage/', './')),
      ]),
    ).toEqual([])
    expect(A4_COMPOSITION_ROOT.detect([planted('apps/api/src/bootstrap/x.ts', code)])).toEqual([])
  })

  test('A5 fires on a value import of kysely outside a repository', () => {
    const value = "import { sql } from 'kysely'"
    expect(
      A5_KYSELY_IN_REPOSITORIES.detect([planted('apps/api/src/features/chat/service.ts', value)]),
    ).toHaveLength(1)
    expect(
      A5_KYSELY_IN_REPOSITORIES.detect([
        planted('apps/api/src/features/chat/repository-x.ts', value),
        planted('apps/api/src/features/chat/service.ts', "import type { Kysely } from 'kysely'"),
      ]),
    ).toEqual([])
  })

  test('A6 fires on a value cycle, not a type-only one', () => {
    const a = planted('apps/api/src/features/a/x.ts', "import { b } from '../b/y'")
    expect(
      A6_FEATURE_CYCLES.detect([
        a,
        planted('apps/api/src/features/b/y.ts', "import { a } from '../a/x'"),
      ]),
    ).toHaveLength(2)
    expect(
      A6_FEATURE_CYCLES.detect([
        a,
        planted('apps/api/src/features/b/y.ts', "import type { A } from '../a/x'"),
      ]),
    ).toEqual([])
  })

  test('A7 fires on ApiError outside a route module', () => {
    const code = "throw new ApiError(404, 'x', 'X')"
    expect(
      A7_HTTP_ERRORS_IN_ROUTES.detect([planted('apps/api/src/features/a/service.ts', code)]),
    ).toHaveLength(1)
    expect(
      A7_HTTP_ERRORS_IN_ROUTES.detect([
        planted('apps/api/src/features/a/routes.ts', code),
        planted('apps/api/src/features/a/routes/items.ts', code),
        planted('apps/api/src/features/a/model-routes.ts', code),
      ]),
    ).toEqual([])
  })

  test('a new violation and a stale baseline entry both fail with the rule id', () => {
    const rule: Rule = { id: 'A7', fix: 'do the thing', detect: () => [] }
    const failures = ratchet(rule, ['planted/new-offender.ts creates ApiError'], [])
    expect(
      failures.some(
        (line) =>
          line.startsWith('A7 planted/new-offender.ts') && line.includes('fix: do the thing'),
      ),
    ).toBe(true)
    expect(ratchet(rule, [], ['planted/fixed.ts creates ApiError'])).toEqual([
      'A7 stale baseline entry planted/fixed.ts creates ApiError — fix: remove it from scripts/architecture-baselines/a7.json',
    ])
  })
})
