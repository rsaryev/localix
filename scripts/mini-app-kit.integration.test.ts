// The mini app kit as staged from the REAL repository: what a release publishes for building mini
// apps outside it. Localix builds no mini app; the authoring plugin (in the Localix
// marketplace) scaffolds, checks and packs against this kit, and its own tests cover that side.
// These pin what the kit itself promises. Each case names the failure it pins.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from '@localixai/mini-app-kit-compiler'

import { MINI_APP_KIT_DIGEST } from '../apps/api/src/features/mini-apps/kit-layout'
import { kitCacheRoot } from './mini-app-kit-cache.mjs'

const repoRoot = resolve(import.meta.dir, '..')
const KIT_STAGER = join(import.meta.dir, 'stage-mini-app-kit.mjs')
const root = mkdtempSync(join(tmpdir(), 'mini-app-kit-'))
const kitDir = join(root, 'kit')
let manifest: {
  typePaths: Record<string, string>
  kitDigest?: string[]
  authoring: { tools: string }
}

beforeAll(() => {
  // A child, as staging runs it: a second in-process build of the SDK's own modules within one
  // `bun test` run trips a Bun resolver error (EISDIR) that the real, one-shot stager never meets.
  // Its own deadline: a blocked synchronous child is invisible to bun's per-test timeout.
  // The shared content-keyed cache: a re-run with unchanged inputs copies the kit instead of
  // staging it again (`mini-app-kit-cache.mjs`); a change to staging misses and stages fresh.
  execFileSync('bun', [KIT_STAGER, repoRoot, kitDir, `--cache=${kitCacheRoot(repoRoot)}`], {
    stdio: 'pipe',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  })
  manifest = JSON.parse(readFileSync(join(kitDir, 'kit.json'), 'utf8'))
}, 70_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Every file under `dir`, relative to it. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
}

describe('the staged kit', () => {
  // The plugin judges a mini app with Localix's own rules: what the kit's tools say about a folder
  // is what discovery and the store say when Localix reads it.
  test('its tools judge a folder the way Localix does', async () => {
    const { tools } = await import(pathToFileURL(join(kitDir, manifest.authoring.tools)).href)
    const dir = join(root, 'tally')
    mkdirSync(dir)
    writeFileSync(
      join(dir, 'mini-app.json'),
      JSON.stringify({ name: 'tally', version: '0.1.0', description: 'x', skills: './skills' }),
    )
    const verdict = await tools.manifest.validate(dir)
    expect(verdict.errors.join('\n')).toContain('Invalid mini-app.json')
  })

  // `skipLibCheck` hides an error INSIDE a declaration file: a generated kit type that named
  // something it did not declare would silently become `any` in every mini app. So the kit's own
  // declarations are checked here, with nothing skipped.
  test('the generated kit declarations are self-contained', () => {
    const kitTypes = join(kitDir, 'types', 'kit')
    const files = listFiles(kitTypes).map((file) => join(kitTypes, file))
    const program = ts.createProgram({
      rootNames: files,
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        strict: true,
        noEmit: true,
        types: [],
        paths: Object.fromEntries(
          Object.entries(manifest.typePaths).map(([specifier, file]) => [
            specifier,
            [join(kitDir, file)],
          ]),
        ),
      },
    })
    const inKit = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName.startsWith(kitTypes))
      .map((diagnostic) => {
        const at = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
        const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
        return `${diagnostic.file!.fileName.slice(kitTypes.length + 1)}:${at.line + 1} ${text}`
      })
    expect(inKit).toEqual([])
  })

  // A kit declaration that fails the check above is staged names-only, every export `any`, with no
  // error anywhere. The board module fell there twice at once: its `Node`/`Edge` re-exports were
  // declared without their type-parameter defaults, and `Handle` — a component AND a type alias in
  // the flow library — was read as a type only, so `<Handle>` would not have type-checked either.
  test('the board module stages typed, a component-and-type name as its component', () => {
    const text = readFileSync(join(kitDir, 'types', 'kit', 'canvas.d.ts'), 'utf8')
    expect(text).toStartWith('// Generated from the host kit')
    expect(text).toMatch(/^export declare const Handle: \(props: \{/mu)
    expect(text).toMatch(/^export type CanvasEdgeType = /mu)
  })

  // The kit must not point back into the source tree, or an installed app's kit would break.
  test('names no path of the repository it was staged from', () => {
    const texts = [
      readFileSync(join(kitDir, 'kit.json'), 'utf8'),
      ...listFiles(join(kitDir, 'ui', 'styles')).map((file) =>
        readFileSync(join(kitDir, 'ui', 'styles', file), 'utf8'),
      ),
    ]
    for (const text of texts) expect(text).not.toContain(repoRoot)
  })

  test('the digest the instruction carries describes every core control', () => {
    expect(manifest.kitDigest).toHaveLength(MINI_APP_KIT_DIGEST.length)
    for (const [index, entry] of MINI_APP_KIT_DIGEST.entries()) {
      const [id, name] = entry.split(':')
      expect(manifest.kitDigest?.[index]).toStartWith(`@localixai/kit/${id} ${name}({`)
    }
  })
})
