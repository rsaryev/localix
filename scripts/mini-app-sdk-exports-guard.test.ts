import { describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { sourceTree } from '@localixai/source-lint'
import {
  emittedFiles,
  ensureDistBuilt,
  type ExportMap,
  exportMapProblems,
  readExportMap,
  repoRoot,
  sdkRoot,
} from './mini-app-sdk-exports'

/**
 * `@localixai/mini-app-sdk`'s export map must be impossible to get wrong.
 *
 * The map is ~32 hand-written subpaths into `dist`, and the two sides it joins are checked by
 * nothing: `tsc --noEmit` reads `src` and never opens the manifest, and no bundler config anywhere
 * derives entries from `exports`. So a subpath can name a module that is never emitted, a `types`
 * can drift off its `import`, and a subpath can be spelled in an import that the map does not
 * publish — all of which resolve fine in this checkout (where a stale `dist` lingers and the host
 * bundler falls back to source paths) and break for a consumer.
 *
 * `dist` is a build artifact, so this suite BUILDS it when it is missing or older than `src` rather
 * than skipping. A skip is indistinguishable from a pass, and the fresh clone that has no `dist` is
 * exactly the case a broken map survives longest in.
 *
 * The positive control below is the part that makes the green mean something: every rule here is
 * satisfied by an empty problem list, and so is a checker that reads nothing. So each planted shape
 * goes through the REAL `exportMapProblems` — six of them in memory, one on disk — and the test
 * fails if the detector comes back quiet.
 */

const CONSUMER_ROOTS = ['apps/api/src', 'apps/ui/src', 'packages', 'mini-apps']

/** `from '@localixai/mini-app-sdk/ui/classes'` — the specifier, never a mention in prose. */
const SDK_SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]@localixai\/mini-app-sdk([^'"]*)['"]/g

/** A planted defect, and the phrase the detector owes us for it. */
interface Control {
  readonly label: string
  readonly plant: (map: ExportMap) => ExportMap
  readonly subpath: string
  readonly expects: RegExp
}

const CONTROLS: readonly Control[] = [
  {
    label: 'a subpath pointing at a module the build never emits',
    plant: (map) => ({
      ...map,
      './ui/ghost': { types: './dist/ui/ghost.d.ts', import: './dist/ui/ghost.js' },
    }),
    subpath: './ui/ghost',
    expects: /is not emitted/u,
  },
  {
    label: 'a types condition that names a different module than import',
    plant: (map) => ({
      ...map,
      './ui/classes': { types: './dist/ui/classes.d.ts', import: './dist/ui/storage.js' },
    }),
    subpath: './ui/classes',
    expects: /DIFFERENT modules/u,
  },
  {
    label: 'conditions written in the order Node reads last',
    plant: (map) => ({
      ...map,
      './ui/classes': { import: './dist/ui/classes.js', types: './dist/ui/classes.d.ts' },
    }),
    subpath: './ui/classes',
    expects: /first-match-wins/u,
  },
  {
    label: 'a subpath into src, which the tarball does not ship',
    plant: (map) => ({
      ...map,
      './ui/classes': { types: './src/ui/classes.ts', import: './src/ui/classes.ts' },
    }),
    subpath: './ui/classes',
    expects: /must point into \.\/dist\//u,
  },
  {
    label: 'a subpath exporting a test module',
    plant: (map) => ({
      ...map,
      './ui/probe': {
        types: './dist/ui/segmented-control.test.d.ts',
        import: './dist/ui/segmented-control.test.js',
      },
    }),
    subpath: './ui/probe',
    expects: /test module/u,
  },
  {
    label: 'a bare string entry that ships no types',
    plant: (map) => ({ ...map, './ui/bare': './dist/ui/classes.js' }),
    subpath: './ui/bare',
    expects: /condition object/u,
  },
]

/** The one control that cannot be planted in memory: emitted output with no source behind it. */
const ORPHAN_SUBPATH = './ui/__export-control-orphan'
const ORPHAN_BASE = 'ui/__export-control-orphan'

describe('mini-app-sdk export map', () => {
  const dist = ensureDistBuilt()
  const map = readExportMap()

  test('the guard ran against a real dist, built if it had to be', () => {
    expect(['present', 'rebuilt']).toContain(dist)
    expect(emittedFiles().length).toBeGreaterThan(50)
  })

  test('every entry resolves to an emitted module, a source module, and an agreeing pair', () => {
    expect(exportMapProblems(map)).toEqual([])
  })

  test('the detector fires on every defect it claims to catch', () => {
    const blind: string[] = []
    for (const control of CONTROLS) {
      const found = exportMapProblems(control.plant(map)).filter((problem) =>
        problem.includes(`"${control.subpath}"`),
      )
      if (found.length === 0) {
        blind.push(`${control.label}: planted at ${control.subpath}, reported NOTHING.`)
        continue
      }
      if (!found.some((problem) => control.expects.test(problem))) {
        blind.push(
          `${control.label}: reported ${JSON.stringify(found)} — none of it matches ` +
            `${String(control.expects)}, so the entry was caught for the wrong reason.`,
        )
      }
    }
    expect(blind).toEqual([])
  })

  test('the detector fires on an emitted module with no source behind it', () => {
    const emitted = join(sdkRoot, 'dist', `${ORPHAN_BASE}.js`)
    const declarations = join(sdkRoot, 'dist', `${ORPHAN_BASE}.d.ts`)
    try {
      writeFileSync(emitted, 'export const orphan = 1\n')
      writeFileSync(declarations, 'export declare const orphan: number\n')
      const problems = exportMapProblems({
        ...map,
        [ORPHAN_SUBPATH]: {
          types: `./dist/${ORPHAN_BASE}.d.ts`,
          import: `./dist/${ORPHAN_BASE}.js`,
        },
      }).filter((problem) => problem.includes(ORPHAN_SUBPATH))
      expect(problems.join('\n')).toMatch(/no source module behind it/u)
    } finally {
      rmSync(emitted, { force: true })
      rmSync(declarations, { force: true })
    }
  })

  test('the build emits no test modules into dist', () => {
    const tests = emittedFiles().filter((file) => /(^|\/|\.)test\./.test(file))
    expect(tests).toEqual([])
  })
})

describe('mini-app-sdk subpaths and their importers agree', () => {
  ensureDistBuilt()
  const map = readExportMap()
  // The anti-void assertion: these witnesses are the two heaviest importers of the SDK, and if the
  // walk stops finding them it is reading empty air and every rule below passes by default.
  const files = sourceTree({
    roots: CONSUMER_ROOTS.map((root) => join(repoRoot, root)),
    mustInclude: [
      'apps/ui/src/shared/contrib/uiLocations.ts',
      /mini-apps\/database\/ui\/register\.tsx$/,
    ],
    minFiles: 500,
    label: 'the first-party consumers of @localixai/mini-app-sdk',
  }).filter((file) => !file.startsWith(sdkRoot))

  const imported = new Map<string, string[]>()
  for (const file of files) {
    for (const [, tail] of readFileSync(file, 'utf8').matchAll(SDK_SPECIFIER)) {
      const subpath = tail === '' ? '.' : `.${tail}`
      const seen = imported.get(subpath)
      if (seen) seen.push(relative(repoRoot, file))
      else imported.set(subpath, [relative(repoRoot, file)])
    }
  }

  test('the scan actually found the imports it is reasoning about', () => {
    expect(imported.get('./ui/classes')?.length ?? 0).toBeGreaterThan(50)
  })

  test('every subpath an import names is published by the export map', () => {
    const unpublished = [...imported]
      .filter(([subpath]) => !(subpath in map))
      .map(
        ([subpath, importers]) =>
          `"${subpath}" is imported by ${importers.length} file(s) (e.g. ${importers[0]}) but is not ` +
          'in packages/mini-app-sdk/package.json exports — it resolves here only because the host ' +
          'bundler falls back to the workspace source, and resolves nowhere once published.',
      )
    expect(unpublished).toEqual([])
  })

  test('every published subpath has at least one first-party importer', () => {
    const orphaned = Object.keys(map)
      .filter((subpath) => !imported.has(subpath))
      .map(
        (subpath) =>
          `"${subpath}" is published but nothing imports it — delete the entry, or import it from ` +
          'the surface it was added for. A subpath nobody uses is public API kept alive by nobody.',
      )
    expect(orphaned).toEqual([])
  })
})
