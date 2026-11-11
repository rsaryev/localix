import type { ModsHost as KitModsHost, ModPlugin, SessionEndReason } from '@rsaryev/llx-plugin/mods'
import { diskFiles } from '../../plugins/kit'
import type { ModScene, ModSource, ModsPorts } from '../contracts'
import { modIdOf } from './session-policy'

/**
 * A conversation's mods host as `session-host.ts` keeps it: its key, the mods it loaded and their
 * revision, and how it goes (`session.end` heard first). A line the kit reports is reported under
 * the mod it names.
 */

export interface Live {
  host: Promise<KitModsHost>
  revision: string
  scene: ModScene
  sources: readonly ModSource[]
  /** When it goes for being unused (`idleMs` of `session-host.ts`). */
  idle?: () => void
  /** The host once it loaded, and why each mod it was given did not load. */
  ready?: { kit: KitModsHost; failures: ReadonlyMap<string, string> }
}

/** A loaded host, as the screen and the Store read it. */
export interface LiveHost {
  key: string
  scene: ModScene
  kit: KitModsHost
  failures: ReadonlyMap<string, string>
}

export const keyOf = (scene: ModScene) => scene.sessionId ?? `workspace:${scene.cwd}`
export const revisionOf = (sources: readonly ModSource[]) =>
  sources.map((source) => `${source.plugin}=${source.revision}`).join('\n')
/**
 * A host goes, `session.end` heard first: the kit's `endSession` names the conversation it ran for
 * (`sessionId`, `resume.id`); the workspace's host, the session of its own it ran as. One that never
 * finished loading has nothing to dispose.
 */
export async function disposeOf(
  entry: Pick<Live, 'host' | 'idle'> | undefined,
  reason: Extract<SessionEndReason, 'resume' | 'other'> = 'other',
) {
  entry?.idle?.()
  const kit = await entry?.host.catch(() => undefined)
  if (!kit) return
  await kit.endSession(reason).catch(() => undefined)
  await kit.dispose()
}

/** Why each of `sources` did not load: the report's line that names it. */
export function failuresOf(
  sources: readonly ModSource[],
  report: { loaded: readonly { name: string }[]; lines: readonly string[] },
) {
  const loaded = new Set(report.loaded.map((mod) => mod.name))
  return new Map(
    sources
      .filter((source) => !loaded.has(source.plugin))
      .map((source) => [
        source.plugin,
        report.lines.find((line) => line.includes(source.plugin)) ??
          'its hooks module did not load',
      ]),
  )
}

/** A kit line names its mod first (`my-mod: …`): reported under that mod, its name said once. */
export function reportLine(
  ports: ModsPorts,
  line: string,
  plugins: readonly string[],
  fallback = 'mods',
) {
  const plugin = plugins.find((name) => line.startsWith(`${name}: `))
  ports.report(plugin ?? fallback, plugin ? line.slice(plugin.length + 2) : line)
}

export const nameOf = (pluginId: string) => pluginId.replace(/@inline$/, '')
export const processEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

export const modPluginOf = (source: ModSource): ModPlugin => ({
  candidate: {
    id: modIdOf(source.plugin),
    name: source.plugin,
    isBuiltin: false,
    dependencies: [],
  },
  files: diskFiles(source.root),
})
