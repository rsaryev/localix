import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { backendSource, buildMiniAppBackend } from '../build/backend-build'
import { assertSafeAuthoringPaths } from '../build/output-paths'
import { buildMiniAppUi } from '../build/ui-build'
import type { Kit } from '../kit/kit'
import { writeKitCatalog } from '../kit/kit-files'
import { errorMessage } from '../lib/errors'
import { runBun } from '../lib/run-bun'
import { findTemplateResidue, listFiles, loadTemplateScaffold } from '../scaffold/template-layout'
import { checkMiniAppBindings } from './bindings'
import { checkMiniAppStoreMedia } from './media'
import { checkMiniAppRoutes } from './routes'
import { checkMiniAppStyle } from './style'
import { typecheckMiniApp, writeMiniAppTsconfig } from './typecheck'

/**
 * Judge one mini app the way Localix will run it: template leftovers, the house style, the routes,
 * the store media, the message bindings, the manifest, the backend build, the UI build, types and
 * the app's own tests. One call, so the agent and the person get the same gates in the same order
 * and one to-do list rather than a guess at which scripts exist.
 *
 * The builds write to a candidate folder that becomes the package only when the caller asks for it
 * and every step but the store media passed (the media matter to a catalog, not to running): a
 * failed check never replaces the last good package.
 */

export interface CheckStep {
  title: string
  ok: boolean
  problems: string[]
  /** An infrastructure error, never excusable as an expected template leftover. */
  errored?: boolean
  /** What Localix will mention but not refuse. */
  warnings?: string[]
}

export interface CheckReport {
  /** Every step passed. */
  ok: boolean
  /** Every step that a package depends on passed. */
  buildable: boolean
  steps: CheckStep[]
}

/** The built outputs of a passing check, in a candidate folder the caller owns. */
export interface CheckOutputs {
  dir: string
  manifest: Record<string, unknown>
  /** The manifest's `backend` for the package, or null for an app without one. */
  backend: string | null
  hasUi: boolean
}

export type TestRunner = (input: { miniAppDir: string; preload: string }) => Promise<{
  ok: boolean
  output: string
}>

export const STORE_MEDIA_STEP = 'store media'
const TEST_TIMEOUT_MS = 120_000
const OUTPUT_TAIL_LINES = 60
const TEST_FILE = /\.test\.tsx?$/u
export const MANIFEST_FILE = 'mini-app.json'

function tail(output: string): string[] {
  return output.trimEnd().split('\n').slice(-OUTPUT_TAIL_LINES)
}

/** `bun test` with the kit's preload serving the host's shared modules. */
export const runMiniAppTests: TestRunner = async ({ miniAppDir, preload }) => {
  const run = await runBun(['test', '--preload', preload], miniAppDir, TEST_TIMEOUT_MS)
  return { ok: run.code === 0, output: run.output }
}

async function step(title: string, run: () => Promise<string[]>): Promise<CheckStep> {
  try {
    const problems = await run()
    return { title, ok: problems.length === 0, problems }
  } catch (error) {
    return { title, ok: false, problems: tail(errorMessage(error)), errored: true }
  }
}

async function readManifest(dir: string): Promise<Record<string, unknown>> {
  const text = await fs.readFile(join(dir, MANIFEST_FILE), 'utf8').catch(() => {
    throw new Error(`${MANIFEST_FILE} is missing`)
  })
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch (error) {
    throw new Error(`${MANIFEST_FILE} is not valid JSON: ${(error as Error).message}`)
  }
}

export async function checkMiniApp(input: {
  kit: Kit
  miniAppDir: string
  runTests?: TestRunner
  /** The untouched reference has residue by design; every other step must still pass. */
  allowTemplateResidue?: boolean
  /** Keep the built outputs for a package: the caller removes `outputs.dir`. */
  keepOutputs?: boolean
}): Promise<{ report: CheckReport; outputs: CheckOutputs | null }> {
  const { kit, miniAppDir, runTests = runMiniAppTests } = input
  await assertSafeAuthoringPaths(miniAppDir)
  const manifest = await readManifest(miniAppDir)
  const name = typeof manifest.name === 'string' ? manifest.name : ''
  const candidate = join(miniAppDir, 'dist', `.candidate-${randomUUID()}`)
  let backend: string | null = null
  let hasUi = false

  // Tests and type-checking read source, while the builders write only to the candidate. Give
  // tests a complete tsconfig first, then run independent gates together.
  await writeMiniAppTsconfig(kit, miniAppDir)
  await writeKitCatalog(kit, miniAppDir)
  const steps = await Promise.all([
    step('template residue', async () =>
      findTemplateResidue(miniAppDir, name, loadTemplateScaffold(kit.templateDir), kit.templateDir),
    ),
    kit.tools.manifest.validate(miniAppDir).then(
      ({ errors, warnings }): CheckStep => ({
        title: 'manifest',
        ok: errors.length === 0,
        problems: errors,
        ...(warnings.length ? { warnings } : {}),
      }),
      (error: unknown): CheckStep => ({
        title: 'manifest',
        ok: false,
        problems: tail(errorMessage(error)),
        errored: true,
      }),
    ),
    step('style', () => checkMiniAppStyle(miniAppDir, kit)),
    step('routes', () => checkMiniAppRoutes(miniAppDir, kit)),
    step(STORE_MEDIA_STEP, () => checkMiniAppStoreMedia(kit, miniAppDir, manifest)),
    step('message context', () => checkMiniAppBindings(miniAppDir)),
    step('backend build', async () => {
      const entry = backendSource(miniAppDir, manifest)
      if (entry) backend = await buildMiniAppBackend({ kit, miniAppDir, entry, outRoot: candidate })
      return []
    }),
    step('UI build', async () => {
      hasUi =
        (await buildMiniAppUi({
          kit,
          miniAppDir,
          outDir: join(candidate, kit.tools.ui.artifactDir),
        })) !== null
      return []
    }),
    step('types', () => typecheckMiniApp(kit, miniAppDir)),
    step('tests', async () => {
      if (!listFiles(miniAppDir).some((file) => TEST_FILE.test(file))) return []
      const result = await runTests({
        miniAppDir,
        preload: join(kit.dir, kit.manifest.authoring.testPreload),
      })
      return result.ok ? [] : tail(result.output)
    }),
  ])
  const ok = steps.every((entry) => entry.ok)
  const buildable = steps.every(
    (entry, index) =>
      entry.ok ||
      entry.title === STORE_MEDIA_STEP ||
      (index === 0 && input.allowTemplateResidue && !entry.errored),
  )
  const report = { ok, buildable, steps }
  if (!buildable || !input.keepOutputs) {
    await fs.rm(candidate, { recursive: true, force: true })
    return { report, outputs: null }
  }
  return { report, outputs: { dir: candidate, manifest, backend, hasUi } }
}

/** The report as the agent and the person read it. */
export function formatCheck(
  name: string,
  report: CheckReport,
  options: {
    /** An untouched copy: its residue is the whole template domain, which the creation
     *  instruction already lists file by file, so it becomes a count. */
    freshCopy?: boolean
  } = {},
): string {
  const failed = report.steps.filter((entry) => !entry.ok).length
  const lines = [
    report.ok
      ? `${name}: every check passed.`
      : options.freshCopy && report.buildable
        ? `${name}: builds and passes its tests; only the template domain remains to replace.`
        : `${name}: ${failed} check(s) failed.`,
  ]
  for (const [index, entry] of report.steps.entries()) {
    if (options.freshCopy && index === 0 && !entry.ok && !entry.errored) {
      lines.push(
        `- ${entry.title}: ${entry.problems.length} leftovers, expected on a fresh copy — the domain to replace is listed below`,
      )
      continue
    }
    lines.push(`- ${entry.title}: ${entry.ok ? 'ok' : 'FAILED'}`)
    for (const problem of entry.problems) lines.push(`    ${problem}`)
    for (const warning of entry.warnings ?? []) lines.push(`    warning: ${warning}`)
  }
  return lines.join('\n')
}
