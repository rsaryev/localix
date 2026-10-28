// The mini app kit end to end, against the REAL repository: staging writes a kit, and the
// mini-app-authoring plugin builds from that kit alone (scaffold → check → package), and Localix
// installs and loads the package — which is the whole contract between the two: the plugin
// imports nothing of Localix, Localix builds nothing. Each case names the failure it pins.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import ts from '@localixai/mini-app-kit-compiler'

import { installBackendHostModules } from '../apps/api/src/features/mini-apps/backend-host-modules'
import { MINI_APP_KIT_DIGEST } from '../apps/api/src/features/mini-apps/kit-layout'
import { installLocalPackage } from '../apps/api/src/features/mini-apps/local-install'
import { importFreshModule } from '../apps/api/src/lib/module-url'
import { buildMiniAppBackend } from '../plugins/mini-app-authoring/src/build/backend-build'
import { checkMiniApp } from '../plugins/mini-app-authoring/src/check/check'
import { typecheckMiniApp } from '../plugins/mini-app-authoring/src/check/typecheck'
import { type Kit, loadKit } from '../plugins/mini-app-authoring/src/kit/kit'
import { assemblePackage } from '../plugins/mini-app-authoring/src/package/assemble'
import { validatePackage } from '../plugins/mini-app-authoring/src/package/validate'
import { drawIcon } from '../plugins/mini-app-authoring/src/scaffold/icon'
import { scaffoldMiniApp } from '../plugins/mini-app-authoring/src/scaffold/scaffold'
import {
  copyDomain,
  fillPlaceholders,
  findTemplateResidue,
  listFiles,
  loadTemplateScaffold,
} from '../plugins/mini-app-authoring/src/scaffold/template-layout'
import { kitCacheRoot } from './mini-app-kit-cache.mjs'
import { findTemplateMiniApp } from './stage-mini-app-kit.mjs'

/** A mini app's one manifest: name, display name and the built backend it runs. */
const APP_MANIFEST = 'mini-app.json'

const repoRoot = resolve(import.meta.dir, '..')
const KIT_STAGER = join(import.meta.dir, 'stage-mini-app-kit.mjs')
const template = findTemplateMiniApp(repoRoot)
const scaffold = loadTemplateScaffold(template)
const root = mkdtempSync(join(tmpdir(), 'mini-app-kit-'))
let kit: Kit

beforeAll(async () => {
  // A child, as staging runs it: a second in-process build of the SDK's own modules within one
  // `bun test` run trips a Bun resolver error (EISDIR) that the real, one-shot stager never meets.
  // Its own deadline: a blocked synchronous child is invisible to bun's per-test timeout.
  // The shared content-keyed cache: a re-run with unchanged inputs copies the kit instead of
  // staging it again (`mini-app-kit-cache.mjs`); a change to staging misses and stages fresh.
  const cache = `--cache=${kitCacheRoot(repoRoot)}`
  execFileSync('bun', [KIT_STAGER, repoRoot, join(root, 'kit'), cache], {
    stdio: 'pipe',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  })
  kit = await loadKit(join(root, 'kit'))
}, 30_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

let copies = 0
async function freshCopy(name = 'gpu-monitor') {
  return scaffoldMiniApp({ kit, dir: join(root, `apps-${copies++}`, name), name })
}

/** A small mini app of the person's own: no template domain left, one tool and its test. */
function ownMiniApp(): string {
  const dir = join(root, `own-${copies++}`, 'tally')
  const files: Record<string, string> = {
    [APP_MANIFEST]: JSON.stringify({
      name: 'tally',
      version: '0.1.0',
      description: 'Counts things the person asks to count.',
      apiVersion: 1,
      category: 'utilities',
      backend: './backend/index.ts',
      icon: './icon.svg',
    }),
    'guide.md': '# Tally\n\n`tally_add` adds to a named count.\n',
    // Its own icon: one that kept the template's is residue.
    'icon.svg': drawIcon('<circle cx="12" cy="12" r="9"/>'),
    'backend/index.ts': [
      "import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'",
      'const counts = new Map<string, number>()',
      'export function register({ z, defineTool }: MiniAppContext) {',
      '  return {',
      '    tools: [',
      '      defineTool({',
      "        name: 'tally_add',",
      "        label: 'Add to a tally',",
      "        activeVerb: 'Counting',",
      "        description: 'Add a number to a named tally and answer with its total.',",
      '        inputSchema: z.object({ name: z.string(), by: z.number() }),',
      '        mutates: true,',
      "        executionMode: 'sequential',",
      "        classify: () => ({ effect: 'host' }),",
      '        permissionPaths: () => [],',
      '        async execute(_toolCallId, input) {',
      '          const total = (counts.get(input.name) ?? 0) + input.by',
      '          counts.set(input.name, total)',
      '          return { content: `${input.name}: ${total}` }',
      '        },',
      '      }),',
      '    ],',
      '  }',
      '}',
    ].join('\n'),
    'backend/index.test.ts': [
      "import { expect, test } from 'bun:test'",
      "import { z } from 'zod'",
      "import { register } from './index'",
      "test('adds', async () => {",
      '  const { tools } = register({ z, defineTool: (tool: unknown) => tool } as never)',
      '  const add = tools[0] as never as { execute(id: string, input: object): Promise<unknown> }',
      "  expect(await add.execute('1', { name: 'cups', by: 2 })).toEqual({ content: 'cups: 2' })",
      '})',
    ].join('\n'),
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

describe('the staged kit', () => {
  test('carries the template minus its authoring-only files, and every input the build reads', () => {
    const shipped = listFiles(kit.templateDir)
    for (const entry of scaffold.authoringOnly) {
      expect(
        shipped.some((file) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)),
      ).toBe(false)
    }
    expect(shipped).toContain('ui/register.tsx')
    expect(kit.manifest.kitModules).toContain('empty-hint')
    expect(kit.manifest.kitModules).not.toContain('testing')
    expect(kit.manifest.uiSharedExports['@localixai/kit/button']).toContain('Button')
    expect(kit.manifest.uiSharedExports.react).toContain('useState')
    const authoring = kit.manifest.authoring
    for (const file of [
      kit.manifest.hostStylesheet,
      ...Object.values(kit.manifest.backendModules),
      ...Object.values(kit.manifest.uiVendorModules),
      authoring.tools,
      authoring.typecheck,
      authoring.testPreload,
      authoring.tailwindUtilities,
      authoring.typeRoots,
    ]) {
      expect({ file, exists: existsSync(join(kit.dir, file)) }).toEqual({ file, exists: true })
    }
  })

  // The plugin judges a mini app with Localix's own rules: what the kit's tools say about a folder
  // is what discovery and the store say when Localix reads it.
  test('its tools judge a folder the way Localix does', async () => {
    expect(await kit.tools.manifest.validate(kit.templateDir)).toMatchObject({ errors: [] })
    const dir = ownMiniApp()
    writeFileSync(
      join(dir, APP_MANIFEST),
      JSON.stringify({ name: 'tally', version: '0.1.0', description: 'x', skills: './skills' }),
    )
    const verdict = await kit.tools.manifest.validate(dir)
    expect(verdict.errors.join('\n')).toContain('Invalid mini-app.json')
  })

  // `skipLibCheck` hides an error INSIDE a declaration file: a generated kit type that named
  // something it did not declare would silently become `any` in every mini app. So the kit's own
  // declarations are checked here, with nothing skipped.
  test('the generated kit declarations are self-contained', () => {
    const kitTypes = join(kit.dir, 'types', 'kit')
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
          Object.entries(kit.manifest.typePaths).map(([specifier, file]) => [
            specifier,
            [join(kit.dir, file)],
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
    const text = readFileSync(join(kit.dir, 'types', 'kit', 'canvas.d.ts'), 'utf8')
    expect(text).toStartWith('// Generated from the host kit')
    expect(text).toMatch(/^export declare const Handle: \(props: \{/mu)
    expect(text).toMatch(/^export type CanvasEdgeType = /mu)
  })

  // The kit must not point back into the source tree, or an installed app's kit would break.
  test('names no path of the repository it was staged from', () => {
    const texts = [
      readFileSync(join(kit.dir, 'kit.json'), 'utf8'),
      ...listFiles(join(kit.dir, 'ui', 'styles')).map((file) =>
        readFileSync(join(kit.dir, 'ui', 'styles', file), 'utf8'),
      ),
    ]
    for (const text of texts) expect(text).not.toContain(repoRoot)
  })

  // A relative path that climbs out of the template resolves in the repository and nowhere else:
  // the template's `bunfig.toml` preloaded `../../scripts/test-deadline.ts`, so every copy's
  // `bun test` failed outside the repository.
  test('the template names no relative path outside itself', () => {
    const escapes: string[] = []
    for (const file of listFiles(kit.templateDir)) {
      if (!/\.(?:[cm]?[jt]sx?|json|toml|css|html)$/u.test(file)) continue
      const text = readFileSync(join(kit.templateDir, file), 'utf8')
      for (const [path] of text.matchAll(/(?:\.\.\/)+[\w@.-][\w@./-]*/gu)) {
        const target = resolve(dirname(join(kit.templateDir, file)), path)
        if (!target.startsWith(`${kit.templateDir}/`)) escapes.push(`${file}: ${path}`)
      }
    }
    expect(escapes).toEqual([])
  })

  test('the digest the instruction carries describes every core control', () => {
    expect(kit.manifest.kitDigest).toHaveLength(MINI_APP_KIT_DIGEST.length)
    for (const [index, entry] of MINI_APP_KIT_DIGEST.entries()) {
      const [id, name] = entry.split(':')
      expect(kit.manifest.kitDigest?.[index]).toStartWith(`@localixai/kit/${id} ${name}({`)
    }
  })
})

describe('template layout', () => {
  test('every listed entry, domain path and domain identifier exists in the template', () => {
    // A stale list silently stops checking: an entry that no longer exists guards nothing.
    const files = listFiles(template)
    for (const entry of [...scaffold.entry, ...scaffold.domain, ...scaffold.authoringOnly]) {
      const present = entry.endsWith('/')
        ? files.some((file) => file.startsWith(entry))
        : files.includes(entry)
      expect({ entry, present }).toEqual({ entry, present: true })
    }
    const code = files
      .filter((file) => /\.tsx?$/u.test(file))
      .map((file) => readFileSync(join(template, file), 'utf8'))
      .join('\n')
    for (const token of scaffold.domainTokens.map((t) =>
      fillPlaceholders(t, { name: 'template' }),
    )) {
      expect({ token, used: new RegExp(`\\b${token}\\b`, 'u').test(code) }).toEqual({
        token,
        used: true,
      })
    }
  })

  // The instruction sends the agent to these files for the patterns it needs; a pattern whose file
  // moved, or whose anchor was renamed away, sends it to read the wrong thing.
  test('every pattern the instruction points at is in the template, at its anchor', () => {
    expect(scaffold.patterns.length).toBeGreaterThan(0)
    for (const { file, anchor } of scaffold.patterns) {
      const path = join(template, file)
      const found = existsSync(path) && readFileSync(path, 'utf8').includes(anchor)
      expect({ file, anchor, found }).toEqual({ file, anchor, found: true })
    }
  })
})

// Each case below type-checks and builds a whole mini app. With a warm kit cache that takes well
// under bun's 5 s default; a cold CI runner spends longer on the first check.
setDefaultTimeout(120_000)

describe('a scaffolded mini app', () => {
  // A built backend leaves hono, zod and the SDK external: the host serves them at runtime, and
  // these cases load the build the way Localix does — with the host's modules installed.
  beforeAll(() => installBackendHostModules())

  test('is built and tested from the kit; only the residue check fails', async () => {
    const created = await freshCopy()
    const { report } = await checkMiniApp({
      kit,
      miniAppDir: created.dir,
      allowTemplateResidue: true,
    })
    expect(report.buildable).toBe(true)
    expect(report.steps.map(({ title, ok }) => [title, ok])).toEqual([
      ['template residue', false],
      ['manifest', true],
      ['style', true],
      // The reference's own routes pass the rule every copy is held to.
      ['routes', true],
      // The template ships the icon a published mini app needs, so its store media pass.
      ['store media', true],
      ['message context', true],
      ['backend build', true],
      ['UI build', true],
      ['types', true],
      ['tests', true],
    ])
    // The check builds into a candidate it removes; the source folder gains no build.
    expect(readdirSync(join(created.dir, 'dist')).filter((f) => !f.startsWith('.'))).toEqual([])
    const app = JSON.parse(readFileSync(join(created.dir, APP_MANIFEST), 'utf8'))
    expect(app.name).toBe('gpu-monitor')
    expect(app.backend).toBe('./backend/index.ts')
  })

  // The contract end to end: the plugin's package is what Localix installs, switches on and runs.
  test('its package installs into Localix and its backend loads in the host', async () => {
    const dir = ownMiniApp()
    const { report, outputs } = await checkMiniApp({ kit, miniAppDir: dir, keepOutputs: true })
    expect(report.steps.filter(({ ok }) => !ok)).toEqual([])
    const packageDir = await assemblePackage(dir, outputs!)
    rmSync(outputs!.dir, { recursive: true, force: true })
    expect(await validatePackage(kit, packageDir)).toMatchObject({ ok: true, problems: [] })

    const installRoot = join(root, `localix-${copies++}`, 'mini-apps')
    const enabled: string[] = []
    const installed = await installLocalPackage(
      { dir: packageDir, source: dir },
      {
        installRoot,
        enable: async (name) => void enabled.push(name),
        changed: async () => {},
      },
    )
    expect(installed).toMatchObject({ name: 'tally', version: '0.1.0' })
    expect(enabled).toEqual(['tally'])
    const manifest = JSON.parse(readFileSync(join(installRoot, 'tally', APP_MANIFEST), 'utf8'))
    expect(manifest.backend).toMatch(/^\.\/dist\/backend\/index-[0-9a-f]{16}\.mjs$/u)
    expect(existsSync(join(installRoot, 'tally', 'backend'))).toBe(false)
    const backend = await importFreshModule(join(installRoot, 'tally', manifest.backend))
    expect(typeof (backend as { register?: unknown }).register).toBe('function')
  })

  // A rebuild replaced the file the API had imported and `bun --watch` restarted the whole API
  // mid-turn. A build is named by its content: the same source is the same file, an edit a new one.
  test('a backend build is named by its content', async () => {
    const { dir } = await freshCopy()
    const outRoot = join(dir, 'dist', 'out')
    const entry = join(dir, 'backend', 'index.ts')
    const first = await buildMiniAppBackend({ kit, miniAppDir: dir, entry, outRoot })
    expect(await buildMiniAppBackend({ kit, miniAppDir: dir, entry, outRoot })).toBe(first)
    writeFileSync(entry, `${readFileSync(entry, 'utf8')}\nexport const edit = 1\n`)
    const second = await buildMiniAppBackend({ kit, miniAppDir: dir, entry, outRoot })
    expect(second).not.toBe(first)
    expect(existsSync(join(outRoot, first))).toBe(true)
  })

  test('backend build refuses static, dynamic and absolute imports outside the mini app', async () => {
    for (const source of [
      (_outside: string) => `import { secret } from '../../outside'\nexport const value = secret\n`,
      (_outside: string) => `export const load = () => import('../../outside')\n`,
      (outside: string) =>
        `import { secret } from ${JSON.stringify(outside)}\nexport const value = secret\n`,
    ]) {
      const { dir } = await freshCopy()
      const outside = join(dirname(dir), 'outside.ts')
      writeFileSync(outside, 'export const secret = "outside"\n')
      writeFileSync(join(dir, 'backend', 'index.ts'), source(outside))
      await expect(
        buildMiniAppBackend({
          kit,
          miniAppDir: dir,
          entry: join(dir, 'backend', 'index.ts'),
          outRoot: join(dir, 'dist', 'out'),
        }),
      ).rejects.toThrow('outside the mini app')
    }
  })

  // A failed check never replaces the last good package: the agent fixing a type error must not
  // take the installed version's files away.
  test('a failed check keeps the previous package', async () => {
    const dir = ownMiniApp()
    const first = await checkMiniApp({ kit, miniAppDir: dir, keepOutputs: true })
    const packageDir = await assemblePackage(dir, first.outputs!)
    rmSync(first.outputs!.dir, { recursive: true, force: true })
    const before = readFileSync(join(packageDir, APP_MANIFEST), 'utf8')
    writeFileSync(join(dir, 'backend', 'wrong.ts'), 'export const wrong: number = "text"\n')
    const failed = await checkMiniApp({ kit, miniAppDir: dir, keepOutputs: true })
    expect(failed.outputs).toBeNull()
    expect(failed.report.steps.find((entry) => entry.title === 'types')?.ok).toBe(false)
    expect(readFileSync(join(packageDir, APP_MANIFEST), 'utf8')).toBe(before)
    expect(readdirSync(join(dir, 'dist')).some((file) => file.startsWith('.candidate-'))).toBe(
      false,
    )
  })

  test('an unreadable manifest is not excused as template residue', async () => {
    const { dir } = await freshCopy()
    writeFileSync(join(dir, APP_MANIFEST), '{ broken json\n')
    await expect(
      checkMiniApp({ kit, miniAppDir: dir, allowTemplateResidue: true }),
    ).rejects.toThrow('not valid JSON')
    expect(readFileSync(join(dir, APP_MANIFEST), 'utf8')).toBe('{ broken json\n')
  })

  test('generated output and tsconfig cannot follow symlinks outside the mini app', async () => {
    if (process.platform === 'win32') return // Symlink creation can require elevated privileges.
    const { dir } = await freshCopy()
    const outside = join(dirname(dir), `outside-${copies++}`)
    mkdirSync(outside)
    writeFileSync(join(outside, 'marker'), 'keep me')
    symlinkSync(outside, join(dir, 'dist'))
    await expect(checkMiniApp({ kit, miniAppDir: dir })).rejects.toThrow(
      'output path is not a regular directory',
    )
    expect(readFileSync(join(outside, 'marker'), 'utf8')).toBe('keep me')

    const second = await freshCopy()
    const externalConfig = join(dirname(second.dir), `tsconfig-${copies++}.json`)
    writeFileSync(externalConfig, 'keep me')
    symlinkSync(externalConfig, join(second.dir, 'tsconfig.json'))
    await expect(checkMiniApp({ kit, miniAppDir: second.dir })).rejects.toThrow(
      'tsconfig.json must be a regular file',
    )
    expect(readFileSync(externalConfig, 'utf8')).toBe('keep me')
  })

  // A display name is written into source; a quote or backtick in it would break the copy.
  test('a display name cannot break the copy it is written into', async () => {
    const created = await scaffoldMiniApp({
      kit,
      dir: join(root, `quoted-${copies++}`, 'gpu-monitor'),
      name: 'gpu-monitor',
      displayName: 'GPU "Monitor" `x`',
    })
    const manifest = JSON.parse(readFileSync(join(created.dir, APP_MANIFEST), 'utf8'))
    expect(manifest.displayName).toBe('GPU Monitor x')
  })

  // A mini app published `{ strategy, text }` where the SDK takes `{ strategy, bindings }`;
  // every check passed and the tab crashed. The type check names the line.
  test('a type error against the SDK is reported with its file, line and code', async () => {
    const { dir } = await freshCopy()
    writeFileSync(
      join(dir, 'ui', 'Wrong.tsx'),
      [
        "import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'",
        "export const wrong = (publish: PublishMessageContext) => publish({ strategy: 'replace', text: 'x' })",
      ].join('\n'),
    )
    const problems = await typecheckMiniApp(kit, dir)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^ui\/Wrong\.tsx:2:\d+ TS2353: .*'text' does not exist/u)
    expect(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).toContain(kit.dir)
  })

  // A mini app wrote `executionMode: 'serial'` and `execute(input)`. From a kit inside the checkout
  // the checker caught both; from an installed app's kit it saw `ctx.defineTool` as `any` and
  // passed them, because the declarations the SDK's own declarations import were not in the kit.
  // This kit is staged outside the repository, as an installed app's is.
  test('a wrong tool contract is a type error from the kit alone', async () => {
    const { dir } = await freshCopy()
    writeFileSync(
      join(dir, 'backend', 'wrong-tool.ts'),
      [
        "import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'",
        'export const wrong = (ctx: MiniAppContext) =>',
        '  ctx.defineTool({',
        "    name: 'wrong_tool',",
        "    label: 'Wrong',",
        "    activeVerb: 'Doing',",
        "    description: 'A tool with the two mistakes.',",
        '    inputSchema: ctx.z.object({ note: ctx.z.string() }),',
        "    executionMode: 'serial',",
        '    async execute(input) {',
        '      return { content: input.note }',
        '    },',
        '  })',
      ].join('\n'),
    )
    const problems = (await typecheckMiniApp(kit, dir)).join('\n')
    expect(problems).toMatch(/backend\/wrong-tool\.ts:9:\d+ TS2322: .*"serial"/u)
    expect(problems).toMatch(/backend\/wrong-tool\.ts:11:\d+ TS2339: .*'note'/u)
  })

  // The kit used to be declared `any`, so `<Button variant="primary">` checked clean and the agent
  // never learned the props. Now the error itself names the variants that exist.
  test('a wrong kit prop is a type error that names the right values', async () => {
    const { dir } = await freshCopy()
    writeFileSync(
      join(dir, 'ui', 'WrongButton.tsx'),
      [
        "import { Button } from '@localixai/kit/button'",
        'export const Wrong = () => <Button variant="primary">Go</Button>',
      ].join('\n'),
    )
    const problems = (await typecheckMiniApp(kit, dir)).join('\n')
    expect(problems).toMatch(/ui\/WrongButton\.tsx:2:\d+ TS2322: .*"primary".*"mono"/u)
  })

  // The kit carries only lucide-react's ROOT declaration file (its variants were 13 MB nobody can
  // import). A real icon must still check clean and a misspelt one must still be an error, or the
  // trimmed copy silently became `any`.
  test('lucide-react icons are typed from the trimmed declarations', async () => {
    const { dir } = await freshCopy()
    writeFileSync(
      join(dir, 'ui', 'Icons.tsx'),
      [
        "import { Activity, NotAnIconAtAll } from 'lucide-react'",
        'export const Good = () => <Activity size={12} />',
        'export const Bad = NotAnIconAtAll',
      ].join('\n'),
    )
    const problems = (await typecheckMiniApp(kit, dir)).join('\n')
    expect(problems).toMatch(/ui\/Icons\.tsx:1:\d+ TS2305: .*NotAnIconAtAll/u)
    expect(problems).not.toMatch(/ui\/Icons\.tsx:2:/u)
    expect(existsSync(join(kit.dir, 'types', 'node_modules', 'lucide-react', 'dynamic.d.ts'))).toBe(
      false,
    )
  })

  // A timer mini app passed every step with a hand-rolled button in palette colours. The copy's
  // own UI follows the house style (the fresh copy passes the step above); these do not.
  test('the style step names a native control and a palette colour with their lines', async () => {
    const { dir } = await freshCopy()
    writeFileSync(
      join(dir, 'ui', 'Drifted.tsx'),
      [
        'export const Drifted = () => (',
        '  <div className="text-red-500">',
        '    <button onClick={() => {}}>Start</button>',
        '    <input type="file" />',
        '  </div>',
        ')',
      ].join('\n'),
    )
    const { report } = await checkMiniApp({ kit, miniAppDir: dir })
    const style = report.steps.find((entry) => entry.title === 'style')
    expect(style?.ok).toBe(false)
    expect(style?.problems).toEqual([
      expect.stringMatching(/^ui\/Drifted\.tsx:2 text-red-500 — palette colour: /u),
      expect.stringMatching(/^ui\/Drifted\.tsx:3 <button — native control: /u),
    ])
  })

  // `bg-surface-subtle` builds and paints nothing: the theme has no such token. The step reads the
  // names from the staged kit's own stylesheets, so a real token passes on the same line.
  test('the style step names a class whose token the kit theme does not declare', async () => {
    const { dir } = await freshCopy()
    writeFileSync(
      join(dir, 'ui', 'Absent.tsx'),
      [
        'export const Absent = () => (',
        '  <div className="bg-surface-hover text-text-soft rounded-xs">',
        '    <pre className="bg-surface-subtle text-text-muted rounded-3xl" />',
        '  </div>',
        ')',
      ].join('\n'),
    )
    const { report } = await checkMiniApp({ kit, miniAppDir: dir })
    const style = report.steps.find((entry) => entry.title === 'style')
    expect(style?.problems).toEqual([
      expect.stringMatching(/^ui\/Absent\.tsx:3 bg-surface-subtle — absent token --color-/u),
      expect.stringMatching(/^ui\/Absent\.tsx:3 text-text-muted — absent token --color-/u),
      expect.stringMatching(/^ui\/Absent\.tsx:3 rounded-3xl — absent token --radius-/u),
    ])
  })

  // The agent chooses primitives by job from KIT.md in its own folder: the staged kit renders it
  // from the catalog (every kit module, by specifier), scaffolding writes it, and a check restores
  // it — a copy whose catalog was deleted or edited gets the kit's back.
  test('the kit catalog reaches the copy as KIT.md, and a check keeps it current', async () => {
    const staged = readFileSync(join(kit.dir, kit.manifest.authoring.catalog ?? 'missing'), 'utf8')
    for (const id of kit.manifest.kitModules) expect(staged).toContain(`\`@localixai/kit/${id}\``)
    const { dir } = await freshCopy()
    expect(readFileSync(join(dir, 'KIT.md'), 'utf8')).toBe(staged)
    writeFileSync(join(dir, 'KIT.md'), '# stale\n')
    await checkMiniApp({ kit, miniAppDir: dir })
    expect(readFileSync(join(dir, 'KIT.md'), 'utf8')).toBe(staged)
  })

  test('a fresh copy lists every domain file and identifier as residue', async () => {
    const { dir } = await freshCopy()
    const residue = findTemplateResidue(dir, 'gpu-monitor', scaffold, template).join('\n')
    const named = scaffold.domain.filter((path) =>
      new RegExp(scaffold.domainNamedPaths.join('|'), 'iu').test(path),
    )
    for (const path of named) {
      expect(residue).toContain(`${path} keeps its ${scaffold.domainName} name`)
    }
    expect(residue).toContain(
      `\`${fillPlaceholders(scaffold.tools[0]!, { name: 'gpu-monitor' })}\``,
    )
  })

  test("source scans skip a mini app's own Git object directory", async () => {
    const { dir } = await freshCopy()
    const objects = join(dir, '.git', 'objects')
    mkdirSync(objects, { recursive: true })
    writeFileSync(join(objects, 'hidden.test.ts'), 'not source code\n')
    expect(listFiles(dir).some((file) => file.startsWith('.git/'))).toBe(false)
  })

  test('a mini app without tests is reported', async () => {
    const { dir } = await freshCopy()
    for (const path of copyDomain(scaffold, 'gpu-monitor')) {
      rmSync(join(dir, path), { recursive: true, force: true })
    }
    const residue = findTemplateResidue(dir, 'gpu-monitor', scaffold, template)
    expect(residue.some((line) => line.startsWith('no test'))).toBe(true)
  })

  // The agent was once told where the source checkout was, and edited the application itself.
  test('nothing the copy tells its author names the repository or its scripts', async () => {
    const { dir } = await freshCopy()
    for (const file of ['README.md', 'AGENTS.md']) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text).not.toContain(repoRoot)
      expect(text).not.toMatch(/apps\/ui|scripts\/|mini-app:verify|bun run/u)
    }
  })

  // A copy pushed to GitHub as it was carried this computer's kit path in its tsconfig.json.
  test('a copy keeps what the checks generate out of git', async () => {
    const { dir } = await freshCopy()
    const ignored = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n')
    expect(ignored).toEqual(expect.arrayContaining(['tsconfig.json', 'KIT.md', 'dist/']))
  })

  // Packed by the release workflow, a copy was published as "Localix", the template's author.
  test("a copy names no author until its own is set: the template's is not its", async () => {
    const { dir } = await freshCopy()
    const manifest = JSON.parse(readFileSync(join(dir, 'mini-app.json'), 'utf8'))
    expect(manifest.author).toBeUndefined()
  })

  test('refuses a bad name and an existing folder, leaving nothing behind', async () => {
    const parent = join(root, 'refusals')
    await expect(
      scaffoldMiniApp({ kit, dir: join(parent, 'escape'), name: '../escape' }),
    ).rejects.toThrow('lower-kebab-case')
    await scaffoldMiniApp({ kit, dir: join(parent, 'twice'), name: 'twice' })
    await expect(
      scaffoldMiniApp({ kit, dir: join(parent, 'twice'), name: 'twice' }),
    ).rejects.toThrow('already exists')
    symlinkSync(join(parent, 'missing-target'), join(parent, 'dangling'))
    await expect(
      scaffoldMiniApp({ kit, dir: join(parent, 'dangling'), name: 'dangling' }),
    ).rejects.toThrow('already exists')
    expect(listFiles(parent).some((file) => file.startsWith('.scaffold-'))).toBe(false)
  })
})
