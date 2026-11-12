import { describe, expect, test } from 'bun:test'
import {
  A4_COMPOSITION_ROOT,
  A5_KYSELY_IN_REPOSITORIES,
  A6_FEATURE_CYCLES,
  A7_HTTP_ERRORS_IN_ROUTES,
} from './architecture/api-rules'
import { loadSources, planted, ratchet, type Rule, type Source } from './architecture/kit'
import { X1_LAYERS_APART } from './architecture/layer-rules'
import {
  X6_PLUGIN_SEMANTICS_IN_THE_KIT,
  X7_KIT_THROUGH_THE_BOUNDARY,
} from './architecture/plugin-kit-rules'
import {
  A1_PACKAGE_CYCLES,
  A2_AGNOSTIC_CORE,
  A3_PROVIDER_SDK_HOME,
  loadManifests,
} from './architecture/package-rules'

/**
 * Architecture rules A1–A7 (`docs/internals/architecture/README.md`) and X1, X6, X7
 * (`docs/internals/plugins-and-mini-apps.md`), each against the repository
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
  test(
    'X1 plugins and mini apps import nothing of each other',
    () => enforce(X1_LAYERS_APART, repo()),
    TIMEOUT,
  )
  test(
    'X6 no Claude Code plugin semantics outside the kit boundary',
    () => enforce(X6_PLUGIN_SEMANTICS_IN_THE_KIT, repo()),
    TIMEOUT,
  )
  test(
    'X7 kit values only through the boundary; kit types imported directly',
    () =>
      enforce(
        X7_KIT_THROUGH_THE_BOUNDARY,
        loadSources(['apps/', 'packages/', 'scripts/'], { tests: true }),
      ),
    TIMEOUT,
  )
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
  test('X1 fires when one layer imports the other, types included, and not for a consumer', () => {
    const hits = X1_LAYERS_APART.detect([
      planted(
        'apps/api/src/features/plugins/x.ts',
        "import type { MiniAppManifest } from '@localixai/mini-app-sdk/app-manifest'",
      ),
      planted(
        'apps/api/src/features/mini-apps/y.ts',
        "import { loadManifest } from '../plugins/discovery'",
      ),
      planted(
        'packages/mini-app-sdk/src/z.ts',
        "import type { PluginManifest } from '@rsaryev/llx-plugin/format'",
      ),
      planted(
        'apps/api/src/features/chat/both.ts',
        "import { a } from '../plugins/loader'\nimport { b } from '../mini-apps/discovery'",
      ),
    ])
    expect(hits).toHaveLength(3)
    expect(hits.join('\n')).not.toContain('features/chat')
  })

  test('X6 fires on a format marker outside the boundary, not in it, a test or a comment', () => {
    const hits = X6_PLUGIN_SEMANTICS_IN_THE_KIT.detect([
      planted(
        'apps/api/src/features/chat/expand.ts',
        "const out = body.replaceAll('$ARGUMENTS', args)",
      ),
      planted('packages/x/src/read.ts', "const off = frontmatter['disable-model-invocation']"),
      planted('apps/ui/src/view.ts', "const dir = env['CLAUDE_PLUGIN_DATA']"),
      planted('apps/api/src/features/plugins/kit/skills.ts', "body.replaceAll('$ARGUMENTS', a)"),
      planted('apps/api/src/features/chat/expand.test.ts', "expect(t).toContain('$ARGUMENTS')"),
      planted('packages/x/src/testing/plugin.ts', "const file = 'plugin.json'"),
      planted('apps/api/src/features/chat/doc.ts', '// the kit expands $ARGUMENTS\nexport {}'),
    ])
    expect(hits).toEqual([
      'apps/api/src/features/chat/expand.ts spells $ARGUMENTS (skill arguments)',
      'packages/x/src/read.ts spells disable-model-invocation (frontmatter)',
      'apps/ui/src/view.ts spells CLAUDE_PLUGIN_DATA (plugin variables)',
    ])
  })

  test('X6 reads a marker through regex escapes and knows the config, hook and skill markers', () => {
    const hits = X6_PLUGIN_SEMANTICS_IN_THE_KIT.detect([
      planted('apps/api/src/a.ts', 'const ref = /\\$\\{user_config\\.([\\w.-]+)\\}/g'),
      planted('apps/api/src/b.ts', 'const v = /\\$\\{([A-Za-z_]\\w*)(?::-([^}]*))?\\}/g'),
      planted('apps/api/src/c.ts', "const f = join(dir, '.mcp.json')"),
      planted('apps/api/src/d.ts', "const f = join(dir, 'hooks', 'hooks.json')"),
      planted('apps/api/src/e.ts', "const f = join(dir, 'SKILL.md')"),
      planted('apps/api/src/f.ts', "env.CLAUDE_ENV_FILE = file; env['CLAUDE_PROJECT_DIR'] = cwd"),
      planted('apps/api/src/g.ts', 'const run = server.headersHelper'),
      planted('apps/api/src/h.ts', "const forced = mode === 'force-for-plugin'"),
      // Not markers: a shell default without a captured name, a bare `${NAME}` of Localix's own.
      planted('apps/api/src/i.ts', 'const line = \'case "${HISTFILE:-}" in\''),
      planted('apps/api/src/j.ts', 'const t = /\\$\\{([A-Z0-9_]+)\\}/g'),
    ])
    expect(hits).toEqual([
      'apps/api/src/a.ts spells user_config. (user config references)',
      'apps/api/src/b.ts spells ${VAR:-default} (variable expansion)',
      'apps/api/src/c.ts spells .mcp.json (MCP config reading)',
      'apps/api/src/d.ts spells hooks.json (hooks reading)',
      'apps/api/src/e.ts spells SKILL.md (skill reading)',
      'apps/api/src/f.ts spells CLAUDE_PROJECT_DIR (hook variables)',
      'apps/api/src/f.ts spells CLAUDE_ENV_FILE (hook env files)',
      'apps/api/src/g.ts spells headersHelper (MCP headers helper)',
      'apps/api/src/h.ts spells force-for-plugin (plugin settings)',
    ])
  })

  // Which links a plugin copy keeps is the kit's (an archive's links, `planTreeCopy`'s relinks):
  // a link is written only where the kit's verdict is applied.
  test('X6 fires on a symlink or hard link written outside the places that apply the kit', () => {
    const hits = X6_PLUGIN_SEMANTICS_IN_THE_KIT.detect([
      planted('apps/api/src/a.ts', 'await fs.symlink(target, to)'),
      planted('apps/api/src/b.ts', "import { link } from 'node:fs/promises'\nawait link(a, b)"),
      planted('apps/api/src/c.ts', "import { symlinkSync, readFileSync } from 'node:fs'"),
      planted('apps/api/src/d.ts', 'fsp.link(a, b); fs.linkSync(a, b)'),
      planted('apps/api/src/features/plugins/marketplace-zip-extract.ts', 'fs.symlink(t, p)'),
      planted('apps/api/src/features/plugins/kit/ports/staged-directory.ts', 'fs.symlink(t, p)'),
      planted('apps/api/src/e.test.ts', 'await fs.symlink(target, to)'),
      // Not a link: reading one, removing a file, a method of Localix's own.
      planted('apps/api/src/f.ts', 'fs.readlink(p); fs.unlink(p); host.link(u, s, p)'),
      planted('apps/api/src/g.ts', '// fs.symlink is the kit port\nexport {}'),
    ])
    expect(hits).toEqual([
      'apps/api/src/a.ts writes a link (plugin copy links)',
      'apps/api/src/b.ts writes a link (plugin copy links)',
      'apps/api/src/c.ts writes a link (plugin copy links)',
      'apps/api/src/d.ts writes a link (plugin copy links)',
    ])
  })

  test('X7 fires on a kit value or re-export outside the boundary, never on a type import', () => {
    const hits = X7_KIT_THROUGH_THE_BOUNDARY.detect([
      planted(
        'apps/api/src/features/chat/x.ts',
        "import { HOOK_EVENTS } from '@rsaryev/llx-plugin'",
      ),
      planted(
        'apps/api/src/features/chat/x.test.ts',
        "import { createMemoryPorts } from '@rsaryev/llx-plugin/testing'",
      ),
      planted('apps/ui/src/a.ts', "export { readPlugin } from '@rsaryev/llx-plugin/loading'"),
      planted('packages/x/src/b.ts', "const m = await import('@rsaryev/llx-plugin/hooks')"),
      planted('apps/api/src/features/plugins/kit/index.ts', "export * from '@rsaryev/llx-plugin'"),
      planted('apps/api/src/features/plugins/kit/a.test.ts', "import '@rsaryev/llx-plugin/sdk'"),
      planted('apps/ui/src/c.ts', "import { STANDARD_LAYOUT } from '@rsaryev/llx-plugin/layout'"),
      planted('apps/ui/src/d.ts', "import type { E } from '@rsaryev/llx-plugin/elicitation'"),
      planted('apps/ui/src/e.ts', "import { x } from '@rsaryev/llx-plugin-other'"),
      planted('apps/ui/src/f.ts', "import { Box } from '@rsaryev/llx-plugin/mods/elements'"),
      planted('apps/api/src/g.ts', "import { Box } from '@rsaryev/llx-plugin/mods/elements'"),
      planted('apps/ui/src/h.ts', "import { createModHost } from '@rsaryev/llx-plugin/mods'"),
      // A type is named straight from the kit, in any file, tests included.
      planted(
        'apps/api/src/features/chat/t.ts',
        "import type { Plugin } from '@rsaryev/llx-plugin/loading'",
      ),
      planted(
        'apps/api/src/features/mcp/u.ts',
        "import { type Resolved } from '@rsaryev/llx-plugin'",
      ),
      planted(
        'packages/x/src/v.test.ts',
        "import type { Ports } from '@rsaryev/llx-plugin/testing'",
      ),
      // A type import that also brings a value is a value import; a type re-export is a second home.
      planted(
        'apps/api/src/features/chat/w.ts',
        "import { type Plugin, loadPlugin } from '@rsaryev/llx-plugin/loading'",
      ),
      planted(
        'apps/api/src/features/chat/types.ts',
        "export type { Plugin } from '@rsaryev/llx-plugin/loading'",
      ),
    ])
    expect(hits).toEqual([
      'apps/api/src/features/chat/x.ts imports @rsaryev/llx-plugin',
      'apps/api/src/features/chat/x.test.ts imports @rsaryev/llx-plugin/testing',
      'apps/ui/src/a.ts re-exports @rsaryev/llx-plugin/loading',
      'packages/x/src/b.ts imports @rsaryev/llx-plugin/hooks',
      'apps/api/src/g.ts imports @rsaryev/llx-plugin/mods/elements',
      'apps/ui/src/h.ts imports @rsaryev/llx-plugin/mods',
      'apps/api/src/features/chat/w.ts imports @rsaryev/llx-plugin/loading',
      'apps/api/src/features/chat/types.ts re-exports @rsaryev/llx-plugin/loading',
    ])
  })

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
