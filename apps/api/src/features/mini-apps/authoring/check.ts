import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { MINI_APP_UI_ARTIFACT_DIR } from '@localixai/mini-app-sdk/ui-artifact'

import { errorMessage } from '../../../lib/errors'
import {
  buildMiniAppBackend,
  discardMiniAppBackendCandidate,
  pruneMiniAppBackendBuilds,
  publishMiniAppBackend,
} from './backend-build'
import { backendPointer } from '../backend-pointer'
import { checkMiniAppBindings } from './binding-check'
import { runBun } from './bun-child'
import type { MiniAppKit } from './kit'
import { MINI_APP_KIT_TEST_PRELOAD } from './kit-layout'
import { assertSafeAuthoringPaths } from './output-paths'
import { checkMiniAppRoutes } from './route-check'
import { checkMiniAppStyle } from './style-check'
import { findTemplateResidue, listFiles, loadTemplateScaffold } from './template-layout'
import { writeMiniAppKitCatalog } from './kit-catalog'
import { typecheckMiniApp, writeMiniAppTsconfig } from './typecheck'
import {
  buildMiniAppUiArtifact,
  publishMiniAppUiArtifact,
  removeMiniAppUiArtifact,
} from './ui-build'
import { retainPreviousHashedFiles } from './ui-retained-files'

/**
 * Build and judge one USER mini app the way the app will run it: template leftovers, the backend
 * build, the UI build, types, the mini app's own tests. One call, so the agent finishing a scaffold
 * (and a person running `/mini-app reload`) get the same gates in the same order and a to-do list
 * rather than a guess at which scripts exist — and nothing here needs a source tree or a toolchain
 * the user does not have: the builds and the type checker are the app's, and the checker and the
 * tests run on the Bun binary the app ships.
 *
 * The report keeps a stable order and gives the agent a to-do list; checks run together where
 * their inputs do not overlap. The fresh reference intentionally fails only the residue step,
 * which becomes the agent's first to-do list. Later edits publish only after every check passes,
 * so an invalid build cannot replace the previous working backend or UI.
 */

export interface MiniAppCheckStep {
  title: string
  ok: boolean
  problems: string[]
  /** An infrastructure error cannot be accepted as an expected template leftover. */
  errored?: boolean
}

export interface MiniAppCheckReport {
  ok: boolean
  /** True only when checked artifacts became the running mini app's next version. */
  published: boolean
  steps: MiniAppCheckStep[]
}

/** Runs the mini app's tests; `ok` false with the output tail when any failed. */
export type MiniAppTestRunner = (input: {
  miniAppDir: string
  preload: string
}) => Promise<{ ok: boolean; output: string }>

const TEST_TIMEOUT_MS = 120_000
const OUTPUT_TAIL_LINES = 60
const TEST_FILE = /\.test\.tsx?$/u

function tail(output: string): string[] {
  return output.trimEnd().split('\n').slice(-OUTPUT_TAIL_LINES)
}

/** `bun test` on the runtime binary itself — the one the app ships, on every platform. */
export const runMiniAppTests: MiniAppTestRunner = async ({ miniAppDir, preload }) => {
  const run = await runBun(['test', '--preload', preload], miniAppDir, TEST_TIMEOUT_MS)
  return { ok: run.code === 0, output: run.output }
}

async function step(title: string, run: () => Promise<string[]>): Promise<MiniAppCheckStep> {
  try {
    const problems = await run()
    return { title, ok: problems.length === 0, problems }
  } catch (error) {
    return { title, ok: false, problems: tail(errorMessage(error)), errored: true }
  }
}

export async function checkUserMiniApp(input: {
  kit: MiniAppKit
  miniAppDir: string
  name: string
  runTests?: MiniAppTestRunner
  /** The untouched reference intentionally has residue, but all other checks must pass. */
  allowTemplateResidue?: boolean
}): Promise<MiniAppCheckReport> {
  const { kit, miniAppDir, name, runTests = runMiniAppTests } = input
  const liveUiDir = join(miniAppDir, MINI_APP_UI_ARTIFACT_DIR)
  const candidateUiDir = `${liveUiDir}.candidate-${randomUUID()}`
  let backendTools: string | null = null
  let hasUi = false

  // Tests and type-checking read source, while the backend and UI builders write only to their
  // own candidate paths. Give tests a complete tsconfig first, then run independent gates together.
  await assertSafeAuthoringPaths(miniAppDir)
  await writeMiniAppTsconfig(kit, miniAppDir)
  await writeMiniAppKitCatalog(kit, miniAppDir)
  const steps = await Promise.all([
    step('template residue', async () =>
      findTemplateResidue(miniAppDir, name, loadTemplateScaffold(kit.templateDir)),
    ),
    step('style', () => checkMiniAppStyle(miniAppDir, kit)),
    step('routes', () => checkMiniAppRoutes(miniAppDir)),
    step('message context', () => checkMiniAppBindings(miniAppDir)),
    step('backend build', async () => {
      backendTools = await buildMiniAppBackend({ kit, miniAppDir, publish: false })
      return []
    }),
    step('UI build', async () => {
      hasUi =
        (await buildMiniAppUiArtifact({
          kit,
          miniAppDir,
          outDir: candidateUiDir,
        })) !== null
      return []
    }),
    step('types', () => typecheckMiniApp(kit, miniAppDir)),
    step('tests', async () => {
      if (!listFiles(miniAppDir).some((file) => TEST_FILE.test(file))) return []
      const result = await runTests({
        miniAppDir,
        preload: join(kit.dir, MINI_APP_KIT_TEST_PRELOAD),
      })
      return result.ok ? [] : tail(result.output)
    }),
  ])
  const ok = steps.every((entry) => entry.ok)
  const publish = steps.every(
    (entry, index) => entry.ok || (index === 0 && input.allowTemplateResidue && !entry.errored),
  )
  let completed = false
  try {
    if (publish) {
      // Copy older lazy chunks while both live pointers still name the previous build. The
      // manifest and UI directory then move in sequence; restore the manifest if the UI swap
      // fails. Pruning is housekeeping after both live pointers have moved.
      if (hasUi) await retainPreviousHashedFiles(liveUiDir, candidateUiDir)
      const manifestPath = (await backendPointer(miniAppDir)).path
      const previousManifest = await fs.readFile(manifestPath, 'utf8').catch(() => null)
      await publishMiniAppBackend(miniAppDir, backendTools, { prune: false })
      try {
        if (hasUi)
          await publishMiniAppUiArtifact(candidateUiDir, liveUiDir, { retainPrevious: false })
        else await removeMiniAppUiArtifact(liveUiDir)
      } catch (error) {
        if (previousManifest === null) await fs.rm(manifestPath, { force: true })
        else {
          const restore = `${manifestPath}.restore-${randomUUID()}`
          await fs.writeFile(restore, previousManifest)
          await fs.rename(restore, manifestPath)
        }
        throw error
      }
      await pruneMiniAppBackendBuilds(miniAppDir, backendTools).catch(() => {})
      completed = true
    }
  } finally {
    await fs.rm(candidateUiDir, { recursive: true, force: true }).catch(() => {})
    if (!completed) await discardMiniAppBackendCandidate(miniAppDir, backendTools)
  }
  return { ok, published: publish, steps }
}

/** The report as the agent and the chat read it. */
export function formatMiniAppCheck(
  name: string,
  report: MiniAppCheckReport,
  options: {
    previousBuild?: boolean
    /**
     * An untouched copy: its residue is the whole template domain, which the creation
     * instruction already lists file by file. Printed again here it was ~3.5 KB of the model's
     * context saying the same thing, so it becomes a count.
     */
    freshCopy?: boolean
  } = {},
): string {
  const failed = report.steps.filter((entry) => !entry.ok).length
  const lines = [
    report.ok
      ? `${name}: every check passed.`
      : options.freshCopy && report.published
        ? `${name}: built, tested and enabled; only the template domain remains to replace.`
        : `${name}: ${failed} check(s) failed.`,
  ]
  if (!report.published && options.previousBuild !== false) {
    lines.push('No new build was published. If a previous build exists, it remains active.')
  }
  for (const [index, entry] of report.steps.entries()) {
    if (options.freshCopy && index === 0 && !entry.ok && !entry.errored) {
      lines.push(
        `- ${entry.title}: ${entry.problems.length} leftovers, expected on a fresh copy — the domain to replace is listed below`,
      )
      continue
    }
    lines.push(`- ${entry.title}: ${entry.ok ? 'ok' : 'FAILED'}`)
    for (const problem of entry.problems) lines.push(`    ${problem}`)
  }
  return lines.join('\n')
}
