import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { stripComments } from '../apps/api/src/lib/source-lint'

/**
 * The chat history strategy's stage list, pinned as a SET in three directions — the same way
 * the stream contract is pinned:
 *
 *   list → sources   a stage the strategy names but no stage file implements is a typo that
 *                    silently runs nothing (the engine skips unknown names as advisory);
 *   sources → list   a stage a file implements but the strategy never runs is dead code, and
 *                    usually the leftover of a rename that landed on one side;
 *   list → docs      the user-facing page enumerates the stages; a stage the page does not
 *                    name is a behavior the reader cannot find.
 *
 * And one import rule: the compression PRIMITIVES (`planContextCompression`,
 * `pruneWireMessages`, `planCheckpoint`, `projectCheckpoint`) are reached only through the
 * strategy. A second caller is a second policy — exactly the "four layers that each bounded the
 * same history" this rework removed. No exemption list: a module that legitimately needs one of
 * these belongs under `history/`.
 */

const repoRoot = resolve(import.meta.dir, '..')
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')

/** Each strategy and the constant that declares its ordered stage list. */
const STRATEGIES = {
  'chat-hybrid': {
    file: 'apps/api/src/features/chat/runtime/history/chat-strategy.ts',
    list: 'CHAT_STAGES',
  },
} as const
const STAGES_DIR = 'apps/api/src/features/chat/runtime/history/stages'
const DOC = 'docs/features/context-checkpoints.md'

function stagesDeclaredIn(file: string, list: string): Set<string> {
  const src = read(file)
  const block = new RegExp(`export const ${list} = \\[([\\s\\S]*?)\\] as const`).exec(src)?.[1]
  if (!block) throw new Error(`${list} not found in ${file}`)
  return new Set([...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!))
}

/** Stage names ANY strategy runs. */
function declaredStages(): Set<string> {
  const all = new Set<string>()
  for (const { file, list } of Object.values(STRATEGIES)) {
    for (const stage of stagesDeclaredIn(file, list)) all.add(stage)
  }
  return all
}

/** Stage names the stage files construct (`name: 'x'`), plus the media seam, which changes the list type. */
function implementedStages(): Set<string> {
  const names = new Set<string>()
  for (const file of readdirSync(resolve(repoRoot, STAGES_DIR))) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const src = stripComments(read(join(STAGES_DIR, file)))
    for (const m of src.matchAll(/\bname:\s*'([a-z-]+)'/g)) names.add(m[1]!)
    if (file === 'media.ts') names.add('media')
  }
  return names
}

function documentedStages(): Set<string> {
  const doc = read(DOC)
  const table = doc.split('| Stage ')[1]?.split('\n\n')[0] ?? ''
  return new Set([...table.matchAll(/^\| `([a-z-]+)`/gm)].map((m) => m[1]!))
}

describe('history strategy — the stage list is a contract', () => {
  test('every declared stage is implemented, and every implemented stage is declared', () => {
    const declared = [...declaredStages()].sort()
    const implemented = [...implementedStages()].sort()
    expect(declared.length).toBeGreaterThanOrEqual(5)
    expect(implemented).toEqual(declared)
  })

  test('the user-facing page names every stage, and only those', () => {
    const declared = [...declaredStages()].sort()
    expect([...documentedStages()].sort()).toEqual(declared)
  })

  test('the snapshot stage is engine plumbing, not a contract entry', () => {
    // `boundary-snapshot` captures the bounded list for the reminder stage; it transforms
    // nothing. It must not leak into a stage list, or the docs would have to explain a no-op.
    expect(declaredStages().has('boundary-snapshot')).toBe(false)
  })
})

const PRIMITIVES = [
  'planContextCompression',
  'pruneWireMessages',
  'planCheckpoint',
  'projectCheckpoint',
] as const

/** Where a compression primitive may be imported: the strategy, and the owners themselves. */
const ALLOWED_IMPORTERS = [
  /^apps\/api\/src\/features\/chat\/runtime\/history\//,
  /^packages\/agent\/src\/context\//,
]

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(resolve(repoRoot, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path
  }
}

const importsPrimitive = (src: string): string[] =>
  PRIMITIVES.filter((p) =>
    new RegExp(`import\\s*(type\\s*)?\\{[^}]*\\b${p}\\b[^}]*\\}\\s*from`).test(src),
  )

describe('history strategy — compression primitives have one policy owner', () => {
  const roots = [
    'apps/api/src',
    'packages/agent/src',
    'packages/engine-loop/src',
    'packages/engine-models/src',
  ]

  test('no module outside history/ imports a compression primitive', () => {
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const rel = relative(repoRoot, resolve(repoRoot, file))
        if (ALLOWED_IMPORTERS.some((rule) => rule.test(rel))) continue
        const found = importsPrimitive(stripComments(read(file)))
        if (found.length > 0) offenders.push(`${rel}: ${found.join(', ')}`)
      }
    }
    // No exceptions. An exception nobody needs is a licence left lying around; add one only
    // with the reason written here, beside the rule, where the reader of the rule can see it.
    expect(offenders).toEqual([])
  })

  test('positive control: the detector sees a primitive import', () => {
    expect(importsPrimitive("import { pruneWireMessages } from '@localixai/agent'")).toEqual([
      'pruneWireMessages',
    ])
    expect(
      importsPrimitive(
        "import {\n  applyPlan,\n  planContextCompression,\n} from '@localixai/agent'",
      ),
    ).toEqual(['planContextCompression'])
    expect(importsPrimitive("import { applyPlan } from '@localixai/agent'")).toEqual([])
  })
})
