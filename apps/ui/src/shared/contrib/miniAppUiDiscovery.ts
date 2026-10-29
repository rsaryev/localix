import type { MiniAppRecord } from '@/shared/api/contracts'
import { announceMiniAppUiChanged } from './enabledMiniApps'
import { miniAppUiHostFor, removeMiniAppUiContributions } from './host'
import { setMiniAppSources, type MiniAppUiSource } from './miniAppAttribution'
import { artifactUrl, mountStyles } from './miniAppUiStyles'
import { rememberMiniAppUiError } from './miniAppUiProblems'
import {
  MINI_APP_UI_PRELOADED_MODULES,
  MINI_APP_UI_SHARED_GLOBAL,
  type MiniAppUiSharedModules,
} from '@localixai/mini-app-sdk/ui-artifact'
import { createMiniAppUiRuntime, type MiniAppUiArtifact } from './miniAppUiRuntime'

/**
 * The workbench's ONE mini app UI runtime, wired to the host: artifacts come from the capability
 * snapshot, are imported by URL from the API, register through the ownership-stamping façade and
 * are taken back by owner. Loaded lazily by `enabledMiniApps.ts`, only once a snapshot names
 * enabled mini apps, so no mini app code or loader metadata sits on first paint.
 *
 * Nothing here knows about development or about who built a mini app: a UI edit becomes a new
 * artifact revision (built by the authoring plugin or a marketplace release), the
 * API announces it, the next snapshot carries it, and the runtime replaces that mini app — the same
 * path a release takes.
 */

/**
 * The host's shared modules, which the app layer installs at boot (`app/miniAppSharedModules.ts`),
 * loaded far enough that an artifact can read the preloaded ones synchronously. Read through the
 * SDK contract, so this layer never imports the kit the app composes.
 */
async function sharedModulesReady(): Promise<void> {
  const scope = globalThis as unknown as Record<string, MiniAppUiSharedModules | undefined>
  const shared = scope[MINI_APP_UI_SHARED_GLOBAL]
  if (!shared) throw new Error('[mini-app-ui] the host installed no shared modules for mini app UI')
  await Promise.all(MINI_APP_UI_PRELOADED_MODULES.map((specifier) => shared.load(specifier)))
}

let runtime: ReturnType<typeof createMiniAppUiRuntime> | undefined

function miniAppUiRuntime() {
  if (runtime) return runtime
  // Awaited before the first artifact import (a CommonJS dependency that `require`s React finds
  // it loaded) and only then: a snapshot with no artifacts costs nothing.
  let ready: Promise<void> | undefined
  runtime = createMiniAppUiRuntime({
    importEntry: async (artifact) => {
      // A failed preload (a chunk error) must not fail every later import: retry next time.
      ready ??= sharedModulesReady().catch((error: unknown) => {
        ready = undefined
        throw error
      })
      await ready
      return import(/* @vite-ignore */ artifactUrl(artifact.entry, artifact.revision))
    },
    mountStyles,
    hostFor: miniAppUiHostFor,
    remove: removeMiniAppUiContributions,
    announce: announceMiniAppUiChanged,
    report: rememberMiniAppUiError,
  })
  return runtime
}

/** The enabled mini apps that ship a UI artifact, as the runtime's input. */
export function miniAppUiArtifacts(miniApps: readonly MiniAppRecord[]): MiniAppUiArtifact[] {
  return miniApps.flatMap((miniApp) =>
    miniApp.enabled && miniApp.ui ? [{ name: miniApp.name, ...miniApp.ui }] : [],
  )
}

/**
 * What attribution needs to name a mini app from a stack frame: every installed mini app's display
 * name, and the directory each loaded artifact is imported from. The directory is resolved from
 * the SAME URL `importEntry` imports, so the frames of the entry and of every chunk it loads
 * relative to itself lie under it; resolving `.` also drops the revision query, which a chunk's
 * URL does not carry.
 */
export function miniAppSources(miniApps: readonly MiniAppRecord[]): {
  sources: MiniAppUiSource[]
  names: Map<string, string>
} {
  return {
    sources: miniAppUiArtifacts(miniApps).map((artifact) => ({
      miniAppName: artifact.name,
      base: new URL('.', artifactUrl(artifact.entry, artifact.revision)).href,
    })),
    names: new Map(miniApps.map((miniApp) => [miniApp.name, miniApp.displayName || miniApp.name])),
  }
}

/** Converge the workbench on the UI of exactly these (enabled) mini apps; see `reconcile`. */
export const discoverEnabledMiniAppUi = (
  miniApps: readonly MiniAppRecord[],
  settled?: (miniAppName: string, ok: boolean) => void,
): Promise<void> => {
  const { sources, names } = miniAppSources(miniApps)
  setMiniAppSources(sources, names)
  return miniAppUiRuntime().reconcile(miniAppUiArtifacts(miniApps), settled)
}
