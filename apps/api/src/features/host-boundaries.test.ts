/**
 * THE boundaries: features a host ASKS must not import the host that asks them — `features/chat`
 * — not even a type.
 *
 *   - `agents` answers who may be used, which model a card names, who leads. The two used to
 *     import each other: the registry took chat's effort schema and route type, chat took the
 *     registry's builtin records, and the agents service wrote chat's agent table directly
 *     to keep a copied priority fresh. The copy went stale on every path that forgot to sync it.
 *   - `triggers` answers when something wakes a session and whether it landed; `work` answers
 *     what a session has running and how it ended. Both are what chat is built ON — chat wakes,
 *     chat's runner records work — so an import back would make the engine and its host one
 *     knot again.
 *
 * A cycle of imports is a cycle of knowledge: neither side can change a shape without reading
 * the other. So the direction is fixed — chat may use these; they state their own shapes and never
 * reach back. Stricter than agent-core's rule (which allows type imports) because none of them
 * needs chat's shapes: each one they used to borrow was a structural subset they now declare.
 *
 * The honest-lint mechanics (comment stripping, recursive walk, liveness floor, planted positive
 * control) live once in `lib/source-lint.ts`; this file supplies only the detector.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { assertPositiveControl, scanSources, type SourceFile } from '../lib/source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

const FEATURES_DIR = dirname(Bun.fileURLToPath(import.meta.url))

/** Each guarded feature, with a floor proving the walk found its tree. */
const GUARDED = [
  { feature: 'agents', minFiles: 15 },
  { feature: 'triggers', minFiles: 8 },
  { feature: 'work', minFiles: 3 },
] as const

/** Every module specifier a file depends on: static imports, re-exports and dynamic imports. */
function specifiers(code: string): string[] {
  const statics = [...code.matchAll(/^\s*(?:import|export)\s[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm)]
  const dynamics = [...code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)]
  return [...statics, ...dynamics].map((m) => m[1] as string)
}

/** Does this specifier resolve into `features/chat`? */
const isChatModule = (spec: string) => /^\.\.?\/(?:\.\.\/)*chat(\/|$)/.test(spec)

async function chatImports(root: string, minFiles = 1): Promise<string[]> {
  const sources = await scanSources({
    root,
    include: ['**/*.ts'],
    skip: (f) => f.endsWith('.test.ts'),
    // Liveness: "no offender" means something only if the walk found the tree.
    minFiles,
  })
  return sources.flatMap((s: SourceFile) =>
    specifiers(s.code)
      .filter(isChatModule)
      .map((spec) => `${s.file}: ${spec}`),
  )
}

describe('features the host asks must not import features/chat', () => {
  for (const { feature, minFiles } of GUARDED) {
    test(`${feature}: no import of any kind crosses the boundary`, async () => {
      expect(await chatImports(join(FEATURES_DIR, feature), minFiles)).toEqual([])
    })
  }

  test('positive control — a TYPE import of chat fires, planted on disk', async () => {
    await assertPositiveControl({
      subject: 'a type-only import of features/chat',
      // The shape that closed the agents cycle, nested so a walk that stopped recursing is caught.
      file: 'resolver/session-agent-resolver.ts',
      offender:
        "import type { SessionAgentSelection } from '../../chat/service/session-agent-selection'\n",
      detect: chatImports,
      // Neighbouring features are not chat; the detector must stay silent on them.
      scaffold: {
        'clean.ts':
          "import { ApiError } from '../../lib/errors'\nimport type { X } from '../chatter/x'\n",
      },
    })
  })

  test('re-exports and dynamic imports count too', () => {
    expect(specifiers("export type { Route } from '../chat/repository-types'\n")).toEqual([
      '../chat/repository-types',
    ])
    expect(specifiers("const m = await import('../chat/service')\n")).toEqual(['../chat/service'])
    expect(isChatModule('../chat')).toBe(true)
    expect(isChatModule('../../chat/runtime/x')).toBe(true)
    expect(isChatModule('../chat-history/x')).toBe(false)
    expect(isChatModule('@localixai/agent/chat')).toBe(false)
  })
})
