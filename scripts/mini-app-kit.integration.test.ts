// The mini app kit end to end, against the REAL repository: staging writes a kit, and the app's own
// authoring (scaffold → build → test → load) works from that kit alone — which is what an
// installed app with no source tree has. Each case names the failure it pins.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
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

import { checkUserMiniApp } from '../apps/api/src/features/mini-apps/authoring/check'
import { loadMiniAppKit, type MiniAppKit } from '../apps/api/src/features/mini-apps/authoring/kit'
import {
  isUserMiniAppBackendBuild,
  MINI_APP_KIT_DIGEST,
} from '../apps/api/src/features/mini-apps/authoring/kit-layout'
import {
  buildMiniAppBackend,
  discardMiniAppBackendCandidate,
} from '../apps/api/src/features/mini-apps/authoring/backend-build'
import { importFreshModule } from '../apps/api/src/lib/module-url'
import { installBackendHostModules } from '../apps/api/src/features/mini-apps/backend-host-modules'
import { typecheckMiniApp } from '../apps/api/src/features/mini-apps/authoring/typecheck'
import { scaffoldUserMiniApp } from '../apps/api/src/features/mini-apps/authoring/scaffold'
import {
  createMiniAppAuthoring,
  isAuthoredUserMiniApp,
} from '../apps/api/src/features/mini-apps/authoring/service'
import {
  copyDomain,
  fillPlaceholders,
  findTemplateResidue,
  frameDomainImports,
  listFiles,
  loadTemplateScaffold,
} from '../apps/api/src/features/mini-apps/authoring/template-layout'
import { findTemplateMiniApp } from './stage-mini-app-kit.mjs'
import { kitCacheRoot } from './mini-app-kit-cache.mjs'

/** A mini app's one manifest: name, display name and the built backend it runs. */
const APP_MANIFEST = 'mini-app.json'

const repoRoot = resolve(import.meta.dir, '..')
const KIT_STAGER = join(import.meta.dir, 'stage-mini-app-kit.mjs')
const template = findTemplateMiniApp(repoRoot)
const scaffold = loadTemplateScaffold(template)
const root = mkdtempSync(join(tmpdir(), 'mini-app-kit-'))
let kit: MiniAppKit

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
  kit = await loadMiniAppKit(join(root, 'kit'))
}, 30_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

let copies = 0
async function freshCopy(name = 'gpu-monitor') {
  const miniAppsRoot = join(root, `mini-apps-${copies++}`)
  return scaffoldUserMiniApp({ kit, miniAppsRoot, name, takenNames: new Set(['reader']) })
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
    for (const file of [
      kit.manifest.hostStylesheet,
      ...Object.values(kit.manifest.backendModules),
      ...Object.values(kit.manifest.uiVendorModules),
    ]) {
      expect({ file, exists: existsSync(join(kit.dir, file)) }).toEqual({ file, exists: true })
    }
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

  // The kit must not point back into the source tree, or an installed app would break.
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
  // `bun test` failed on an installed app and `/mini-app create` refused every request.
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
    for (const token of scaffold.domainTokens) {
      expect({ token, used: new RegExp(`\\b${token}\\b`, 'u').test(code) }).toEqual({
        token,
        used: true,
      })
    }
  })

  test('the frame imports no domain module, so replacing the domain cannot break it', () => {
    expect(frameDomainImports(template)).toEqual([])
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

  test('positive control: a frame file importing the domain is reported', () => {
    const copy = join(root, 'frame-control')
    cpSync(template, copy, { recursive: true, filter: (src) => !src.includes('node_modules') })
    const domainModule = scaffold.domain.find((path) => /^[^/]+\/[^/.]+\.ts$/u.test(path))!
    const hook = join(copy, 'ui', 'usePolledSnapshot.ts')
    writeFileSync(
      hook,
      `import * as domain from '../${domainModule.slice(0, -3)}'\n${readFileSync(hook, 'utf8')}`,
    )
    expect(frameDomainImports(copy)).toEqual([`ui/usePolledSnapshot.ts → ${domainModule}`])
  })
})

// Each case below type-checks, builds and loads a whole scaffolded mini app. With a warm kit cache
// that takes well under bun's 5 s default, which is why a laptop never sees it; a cold CI runner
// spends longer than that on the first check and fails every case after it on the same deadline.
setDefaultTimeout(120_000)

describe('a scaffolded user mini app', () => {
  // A built backend leaves hono, zod and the SDK external: the host serves them at runtime, and
  // this test loads the build the way the app does — with the host's modules installed.
  beforeAll(() => installBackendHostModules())

  test('is built and tested from the kit, and loads in the host; only the residue check fails', async () => {
    const created = await freshCopy()
    const report = await checkUserMiniApp({
      kit,
      miniAppDir: created.dir,
      name: created.name,
      allowTemplateResidue: true,
    })
    expect(report.published).toBe(true)
    expect(report.steps.map(({ title, ok }) => [title, ok])).toEqual([
      ['template residue', false],
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
    const app = JSON.parse(readFileSync(join(created.dir, APP_MANIFEST), 'utf8'))
    expect(app.name).toBe('gpu-monitor')
    expect(isUserMiniAppBackendBuild(app.backend)).toBe(true)
    expect(app.defaultEnabled).toBeUndefined()
    const backend = await import(join(created.dir, app.backend))
    expect(typeof backend.register).toBe('function')
    expect(existsSync(join(created.dir, 'dist', 'ui', 'manifest.json'))).toBe(true)
  })

  // A rebuild replaced the file the API had imported and `bun --watch` restarted the
  // whole API mid-turn. A build is a new file; the imported one is never touched.
  test('a rebuild never replaces or deletes a build the process imported', async () => {
    const { dir } = await freshCopy()
    const tools = async () => JSON.parse(readFileSync(join(dir, APP_MANIFEST), 'utf8')).backend
    const first = await buildMiniAppBackend({ kit, miniAppDir: dir })
    expect(await buildMiniAppBackend({ kit, miniAppDir: dir })).toBe(first)
    await importFreshModule(join(dir, first!))
    const edit = (n: number) =>
      writeFileSync(
        join(dir, 'backend', 'index.ts'),
        `${readFileSync(join(dir, 'backend', 'index.ts'), 'utf8')}\nexport const edit${n} = ${n}\n`,
      )
    edit(1)
    const second = await buildMiniAppBackend({ kit, miniAppDir: dir })
    expect(second).not.toBe(first)
    expect(await tools()).toBe(second)
    edit(2)
    const third = await buildMiniAppBackend({ kit, miniAppDir: dir })
    expect(existsSync(join(dir, first!))).toBe(true)
    expect(existsSync(join(dir, second!))).toBe(false)
    expect(existsSync(join(dir, third!))).toBe(true)
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
      const before = readFileSync(join(dir, APP_MANIFEST), 'utf8')
      await expect(buildMiniAppBackend({ kit, miniAppDir: dir, publish: false })).rejects.toThrow(
        'outside the mini app',
      )
      expect(readFileSync(join(dir, APP_MANIFEST), 'utf8')).toBe(before)
    }
  })

  test('failed candidate cleanup tolerates a malformed manifest but keeps a referenced build', async () => {
    const { dir } = await freshCopy()
    const tools = './dist/backend/index-1234567890abcdef.mjs'
    const output = join(dir, tools)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, 'export {}\n')
    writeFileSync(join(dir, APP_MANIFEST), '{ malformed')
    await discardMiniAppBackendCandidate(dir, tools)
    expect(existsSync(output)).toBe(false)

    writeFileSync(output, 'export {}\n')
    writeFileSync(join(dir, APP_MANIFEST), JSON.stringify({ backend: tools }))
    await discardMiniAppBackendCandidate(dir, tools)
    expect(existsSync(output)).toBe(true)
  })

  test('a failed type check keeps the previous backend and UI active', async () => {
    const { dir, name } = await freshCopy()
    const first = await checkUserMiniApp({
      kit,
      miniAppDir: dir,
      name,
      allowTemplateResidue: true,
    })
    expect(first.published).toBe(true)
    const manifestBefore = readFileSync(join(dir, APP_MANIFEST), 'utf8')
    const uiBefore = readFileSync(join(dir, 'dist', 'ui', 'manifest.json'), 'utf8')
    const backendBefore = readdirSync(join(dir, 'dist', 'backend'))
    writeFileSync(
      join(dir, 'backend', 'index.ts'),
      `${readFileSync(join(dir, 'backend', 'index.ts'), 'utf8')}\nexport const changed = true\n`,
    )
    writeFileSync(join(dir, 'ui', 'Wrong.tsx'), 'export const wrong: number = "text"\n')

    const failed = await checkUserMiniApp({ kit, miniAppDir: dir, name })
    expect(failed.published).toBe(false)
    expect(failed.steps.find((entry) => entry.title === 'types')?.ok).toBe(false)
    expect(readFileSync(join(dir, APP_MANIFEST), 'utf8')).toBe(manifestBefore)
    expect(readFileSync(join(dir, 'dist', 'ui', 'manifest.json'), 'utf8')).toBe(uiBefore)
    expect(readdirSync(join(dir, 'dist', 'backend'))).toEqual(backendBefore)
  })

  test('an unreadable reference manifest is not excused as template residue', async () => {
    const { dir, name } = await freshCopy()
    writeFileSync(join(dir, APP_MANIFEST), '{ broken json\n')
    const report = await checkUserMiniApp({
      kit,
      miniAppDir: dir,
      name,
      allowTemplateResidue: true,
    })
    expect(report.steps[0]?.errored).toBe(true)
    expect(report.published).toBe(false)
    expect(readFileSync(join(dir, APP_MANIFEST), 'utf8')).toBe('{ broken json\n')
  })

  test('generated output and tsconfig cannot follow symlinks outside the mini app', async () => {
    if (process.platform === 'win32') return // Symlink creation can require elevated privileges.
    const { dir, name } = await freshCopy()
    const outside = join(dirname(dir), `outside-${copies++}`)
    mkdirSync(outside)
    writeFileSync(join(outside, 'marker'), 'keep me')
    symlinkSync(outside, join(dir, 'dist'))
    await expect(checkUserMiniApp({ kit, miniAppDir: dir, name })).rejects.toThrow(
      'output path is not a regular directory',
    )
    expect(readFileSync(join(outside, 'marker'), 'utf8')).toBe('keep me')

    const second = await freshCopy()
    const externalConfig = join(dirname(second.dir), `tsconfig-${copies++}.json`)
    writeFileSync(externalConfig, 'keep me')
    symlinkSync(externalConfig, join(second.dir, 'tsconfig.json'))
    await expect(
      checkUserMiniApp({ kit, miniAppDir: second.dir, name: second.name }),
    ).rejects.toThrow('tsconfig.json must be a regular file')
    expect(readFileSync(externalConfig, 'utf8')).toBe('keep me')
  })

  test('a content-named backend artifact cannot be replaced by a symlink', async () => {
    if (process.platform === 'win32') return
    const { dir } = await freshCopy()
    const tools = await buildMiniAppBackend({ kit, miniAppDir: dir, publish: false })
    expect(tools).toBeTruthy()
    const artifact = join(dir, tools!)
    const outside = join(dirname(dir), `backend-${copies++}.mjs`)
    writeFileSync(outside, 'export const wrong = true\n')
    rmSync(artifact)
    symlinkSync(outside, artifact)
    await expect(buildMiniAppBackend({ kit, miniAppDir: dir, publish: false })).rejects.toThrow(
      'exists with different content or file type',
    )
    expect(readFileSync(outside, 'utf8')).toBe('export const wrong = true\n')
  })

  test('initial check failure rolls the scaffold back before enablement', async () => {
    const miniAppsRoot = join(root, `failed-create-${copies++}`)
    const calls: string[] = []
    let testRuns = 0
    const authoring = createMiniAppAuthoring({
      discover: async () => [],
      miniAppsRoot,
      kitDir: () => kit.dir,
      enable: async () => calls.push('enable'),
      changed: () => calls.push('changed'),
      runTests: async () => ({
        ok: ++testRuns > 1,
        output: 'test failed on purpose',
      }),
    })
    await expect(authoring.create('user', { name: 'broken-template' })).rejects.toThrow(
      'test failed on purpose',
    )
    expect(calls).toEqual([])
    expect(existsSync(join(miniAppsRoot, 'broken-template'))).toBe(false)
    expect((await authoring.create('user', { name: 'broken-template' })).report.published).toBe(
      true,
    )
    expect(calls).toEqual(['enable'])
  })

  test('a failed activation is disabled before the new folder is rolled back', async () => {
    const miniAppsRoot = join(root, `activation-${copies++}`)
    const calls: string[] = []
    const authoring = createMiniAppAuthoring({
      discover: async () => [],
      miniAppsRoot,
      kitDir: () => kit.dir,
      enable: async () => {
        calls.push('enable')
        throw new Error('notification failed after consent was stored')
      },
      disable: async () => {
        calls.push('disable')
      },
      changed: () => {},
    })
    await expect(authoring.create('user', { name: 'activation-failure' })).rejects.toThrow(
      'notification failed after consent was stored',
    )
    expect(calls).toEqual(['enable', 'disable'])
    expect(existsSync(join(miniAppsRoot, 'activation-failure'))).toBe(false)
  })

  // Creation never edits what is there: a folder, a discovered mini app, an install from another
  // source and the template's own name each push the new mini app to the next free name.
  test('a new mini app takes the first name nothing else holds', async () => {
    const miniAppsRoot = join(root, `free-${copies++}`)
    let installedSource: string | null = null
    const authoring = createMiniAppAuthoring({
      discover: async () => [{ name: 'reader' } as never],
      miniAppsRoot,
      kitDir: () => kit.dir,
      installedSource: async (_userId, name) => (name === 'notes' ? installedSource : null),
      enable: async () => {},
      changed: () => {},
    })
    expect(await authoring.freeName('user', 'gpu-monitor')).toBe('gpu-monitor')
    expect(await authoring.freeName('user', 'reader')).toBe('reader-2')
    expect(await authoring.freeName('user', 'template')).toBe('template-2')

    installedSource = 'https://example.com/marketplace.git'
    expect(await authoring.freeName('user', 'notes')).toBe('notes-2')
    await expect(authoring.create('user', { name: 'notes' })).rejects.toThrow(
      'installed from another source',
    )
    expect(existsSync(join(miniAppsRoot, 'notes'))).toBe(false)

    await scaffoldUserMiniApp({
      kit,
      miniAppsRoot,
      name: 'gpu-monitor',
      displayName: 'GPU "Monitor" `x`',
      takenNames: new Set(),
    })
    expect(await authoring.freeName('user', 'gpu-monitor')).toBe('gpu-monitor-2')
    // A display name is written into source; a quote or backtick in it would break the copy.
    const manifest = JSON.parse(
      readFileSync(join(miniAppsRoot, 'gpu-monitor', APP_MANIFEST), 'utf8'),
    )
    expect(manifest.displayName).toBe('GPU Monitor x')
    await expect(authoring.freeName('user', 'Bad Name')).rejects.toThrow('lower-kebab-case')

    rmSync(join(miniAppsRoot, 'gpu-monitor', 'backend', 'index.ts'))
    rmSync(join(miniAppsRoot, 'gpu-monitor', 'ui', 'register.tsx'))
    expect(
      await isAuthoredUserMiniApp({
        dir: join(miniAppsRoot, 'gpu-monitor'),
        bundled: false,
        name: 'gpu-monitor',
        manifest: { name: 'gpu-monitor' },
      } as never),
    ).toBe(true)
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
    const report = await checkUserMiniApp({ kit, miniAppDir: dir, name: 'gpu-monitor' })
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
    const report = await checkUserMiniApp({ kit, miniAppDir: dir, name: 'gpu-monitor' })
    const style = report.steps.find((entry) => entry.title === 'style')
    expect(style?.problems).toEqual([
      expect.stringMatching(/^ui\/Absent\.tsx:3 bg-surface-subtle — absent token --color-/u),
      expect.stringMatching(/^ui\/Absent\.tsx:3 text-text-muted — absent token --color-/u),
      expect.stringMatching(/^ui\/Absent\.tsx:3 rounded-3xl — absent token --radius-/u),
    ])
  })

  test('the digest the instruction carries describes every core control', () => {
    expect(kit.manifest.kitDigest).toHaveLength(MINI_APP_KIT_DIGEST.length)
    for (const [index, entry] of MINI_APP_KIT_DIGEST.entries()) {
      const [id, name] = entry.split(':')
      expect(kit.manifest.kitDigest?.[index]).toStartWith(`@localixai/kit/${id} ${name}({`)
    }
  })

  // The agent chooses primitives by job from KIT.md in its own folder: the staged kit renders it
  // from the catalog (every kit module, by specifier), scaffolding writes it, and a build restores
  // it — a copy whose catalog was deleted or edited gets the kit's back.
  test('the kit catalog reaches the copy as KIT.md, and a build keeps it current', async () => {
    const staged = readFileSync(join(kit.dir, kit.manifest.kitCatalog ?? 'missing'), 'utf8')
    for (const id of kit.manifest.kitModules) expect(staged).toContain(`\`@localixai/kit/${id}\``)
    const { dir } = await freshCopy()
    expect(readFileSync(join(dir, 'KIT.md'), 'utf8')).toBe(staged)
    writeFileSync(join(dir, 'KIT.md'), '# stale\n')
    await checkUserMiniApp({ kit, miniAppDir: dir, name: 'gpu-monitor' })
    expect(readFileSync(join(dir, 'KIT.md'), 'utf8')).toBe(staged)
  })

  test('a fresh copy lists every domain file and identifier as residue', async () => {
    const { dir } = await freshCopy()
    const residue = findTemplateResidue(dir, 'gpu-monitor', scaffold).join('\n')
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
    const residue = findTemplateResidue(dir, 'gpu-monitor', scaffold)
    expect(residue.some((line) => line.startsWith('no test'))).toBe(true)
  })

  // The defect behind this whole module: the agent was told where the source checkout was.
  test('nothing the copy tells its author names the repository or its scripts', async () => {
    const { dir } = await freshCopy()
    for (const file of ['README.md', 'AGENTS.md']) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text).not.toContain(repoRoot)
      expect(text).not.toMatch(/apps\/ui|scripts\/|mini-app:verify|bun run/u)
    }
  })

  test('refuses a bad name, a taken name and an existing folder, leaving nothing behind', async () => {
    const miniAppsRoot = join(root, 'refusals')
    const input = { kit, miniAppsRoot, takenNames: new Set(['reader']) }
    await expect(scaffoldUserMiniApp({ ...input, name: '../escape' })).rejects.toThrow(
      'lower-kebab-case',
    )
    await expect(scaffoldUserMiniApp({ ...input, name: 'reader' })).rejects.toThrow(
      'already exists',
    )
    await scaffoldUserMiniApp({ ...input, name: 'twice' })
    await expect(scaffoldUserMiniApp({ ...input, name: 'twice' })).rejects.toThrow('already exists')
    symlinkSync(join(miniAppsRoot, 'missing-target'), join(miniAppsRoot, 'dangling'))
    await expect(scaffoldUserMiniApp({ ...input, name: 'dangling' })).rejects.toThrow(
      'already exists',
    )
    expect(listFiles(miniAppsRoot).some((file) => file.startsWith('.scaffold-'))).toBe(false)
  })
})
