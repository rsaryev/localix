/**
 * THE runtime layering, enforced instead of merely written down.
 *
 * `run/` is the APPLICATION layer: one agent run, orchestrating infrastructure. The modules
 * beside it in `runtime/` are that INFRASTRUCTURE: the runner, the wake queue, compaction,
 * the state stores. Above both sits `features/chat/service*`, the request/session layer.
 *
 *   service*  →  runtime/  →  runtime/run/        (allowed)
 *   run/      →  service*                          (forbidden)
 *   runtime/  →  run/                              (forbidden)
 *
 * Both forbidden edges were stated in five doc comments (`run/types.ts`, `execute-run.ts`,
 * `precompact-hooks.ts`, `session-start-hooks.ts`, `cc-hooks-build.ts`) and nothing checked
 * them: at the time this lint was written, eight infrastructure modules imported from `run/`
 * and `run/model-history.ts` reached up into `service/message-bindings`. A cycle between the
 * layers is not a style problem — it is what makes the runner impossible to load, test or
 * re-host without dragging the whole session layer in with it.
 *
 * The composition root is the ONE legal exception, and it is not spelled here: `agent-runner.ts`
 * is the module whose job is to wire the layers together, so it is allowed to import the
 * use-case it drives. Anything else that needs `run/` is misfiled.
 *
 * Mechanism (comment-stripping, a recursing walk, an anti-void assertion, an on-disk positive
 * control) is `lib/source-lint.ts`, exactly as in `agent-core/agnostic-boundary.test.ts`. This
 * file supplies only the detectors.
 */
import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import {
  assertNotVoid,
  assertPositiveControl,
  scanSources,
  type SourceFile,
} from '../../../lib/source-lint'

const RUNTIME_DIR = dirname(Bun.fileURLToPath(import.meta.url))
const RUN_DIR = join(RUNTIME_DIR, 'run')

/**
 * The composition root: the one module whose PURPOSE is to bind the layers, so it alone may
 * name the use-case it drives. Keeping the list to a single entry is the point — a growing
 * exemption list means the layering is being negotiated rather than enforced.
 */
const COMPOSITION_ROOTS = new Set(['agent-runner.ts'])

/** Every `import … from '<spec>'` in comment-stripped source. */
function importSpecs(code: string): string[] {
  return [...code.matchAll(/^import\s+[\s\S]*?\s*from\s*['"]([^'"]+)['"]/gm)].map(
    (m) => m[1] as string,
  )
}

/** Does this specifier resolve into `features/chat/service`? */
const isServiceModule = (spec: string) => /(^|\/)service(\/|$)/.test(spec)

/** Does this specifier reach INTO the run/ directory (from outside it)? */
const isRunModule = (spec: string) => /(^|\/)run\//.test(spec)

/** run/ modules that import the session layer. */
async function runImportsService(root: string): Promise<string[]> {
  const sources = await scanSources({
    root,
    include: ['**/*.ts'],
    skip: (f) => f.endsWith('.test.ts'),
    minFiles: 1,
  })
  return sources
    .flatMap((s: SourceFile) => importSpecs(s.code).map((spec) => ({ file: s.file, spec })))
    .filter((i) => isServiceModule(i.spec))
    .map((i) => `${i.file}: imports '${i.spec}'`)
}

/** runtime/ infrastructure modules (run/ itself excluded) that import from run/. */
async function infraImportsRun(root: string): Promise<string[]> {
  const sources = await scanSources({
    root,
    include: ['*.ts'], // ONE level: run/ is a sibling directory, not part of the infra layer.
    skip: (f) => f.endsWith('.test.ts') || COMPOSITION_ROOTS.has(f),
    minFiles: 1,
  })
  return sources
    .flatMap((s: SourceFile) => importSpecs(s.code).map((spec) => ({ file: s.file, spec })))
    .filter((i) => isRunModule(i.spec))
    .map((i) => `${i.file}: imports '${i.spec}'`)
}

describe('runtime layering', () => {
  test('the walks really walk both layers', async () => {
    const [run, infra] = await Promise.all([
      scanSources({ root: RUN_DIR, include: ['**/*.ts'], minFiles: 40 }),
      scanSources({ root: RUNTIME_DIR, include: ['*.ts'], minFiles: 15 }),
    ])
    expect(run.length).toBeGreaterThan(40)
    expect(infra.length).toBeGreaterThan(15)
  })

  test('run/ never imports features/chat/service*', async () => {
    expect(await runImportsService(RUN_DIR)).toEqual([])
  })

  test('runtime infrastructure never imports run/', async () => {
    expect(await infraImportsRun(RUNTIME_DIR)).toEqual([])
  })

  test('the composition root still drives the use-case it is exempted for', async () => {
    // DEAD-EXEMPTION GUARD. The single exemption is only honest while the root actually
    // uses it; if `agent-runner.ts` stops importing run/, the exemption is dead weight and
    // the next module to be misfiled inherits it silently.
    const root = await Bun.file(join(RUNTIME_DIR, 'agent-runner.ts')).text()
    const runImports = importSpecs(root).filter(isRunModule)
    assertNotVoid(
      "the composition root's import of run/",
      runImports.length,
      'agent-runner.ts is the exempted composition root — it must still import the run use-case, or the exemption belongs elsewhere.',
    )
  })

  test('the service matcher is pointed at something — the imports service DOES make', async () => {
    // DEAD-REGEX GUARD, mirroring agnostic-boundary.test.ts: zero offenders is the goal
    // state, so the matcher can never prove itself on the real tree. Assert it still
    // matches the legal direction (service → runtime) instead.
    const sources = await scanSources({
      root: join(RUNTIME_DIR, '..', 'service'),
      include: ['**/*.ts'],
      skip: (f) => f.endsWith('.test.ts'),
      minFiles: 10,
    })
    const runtimeImports = sources
      .flatMap((s) => importSpecs(s.code))
      .filter((spec) => spec.includes('runtime/'))
    assertNotVoid(
      'service → runtime imports',
      runtimeImports.length,
      'the service layer drives the runtime; zero such imports means the tree moved, not that it got cleaner.',
    )
  })

  test('positive control — run/ importing the service layer is caught, planted on disk', async () => {
    await assertPositiveControl({
      subject: 'a run/ module importing features/chat/service',
      // NESTED: a walk that stopped recursing is caught right here.
      file: 'nested-probe/leaky.ts',
      offender: "import { resolveMessageBindings } from '../../../service/message-bindings'\n",
      detect: runImportsService,
      scaffold: {
        'clean.ts': "import { contextBindingsToModelAssets } from '../../model-assets'\n",
      },
    })
  })

  test('positive control — infrastructure importing run/ is caught, planted on disk', async () => {
    await assertPositiveControl({
      subject: 'a runtime/ infrastructure module importing run/',
      file: 'leaky-infra.ts',
      offender: "import { executeRun } from './run/execute-run'\n",
      detect: infraImportsRun,
      scaffold: { 'clean-infra.ts': "import { wrapDelegatedWake } from './wake-envelope'\n" },
    })
  })

  test('the matchers, unit-wise', () => {
    expect(isServiceModule('../../service/message-bindings')).toBe(true)
    expect(isServiceModule('../../../chat/service')).toBe(true)
    expect(isServiceModule('./service-graph')).toBe(false)
    expect(isServiceModule('../services-helper')).toBe(false)
    expect(isRunModule('./run/execute-run')).toBe(true)
    expect(isRunModule('../run/types')).toBe(true)
    expect(isRunModule('./run-params')).toBe(false)
    expect(isRunModule('./run-outcome')).toBe(false)
  })
})
