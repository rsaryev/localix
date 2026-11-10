import { createHash } from 'node:crypto'
import type { EnvFileStore, PluginFiles } from '@rsaryev/llx-plugin'
import type { PluginStateStore, StagedDirectory } from '@rsaryev/llx-plugin/marketplace'
import {
  fakeEnvironment,
  fakeMcp,
  fakeModel,
  fixedClock,
  folderScan,
  locations,
  memoryScratch,
  recordingHttp,
  scriptedRunner,
} from '@rsaryev/llx-plugin/testing'
import type { LocalixKitPorts } from './ports/host-ports'

/**
 * The plugin kit boundary in memory, for other features' tests: every port of `createHostPorts`
 * built from the kit's own fakes (`@rsaryev/llx-plugin/testing`), so a test runs no process, no
 * network and no disk. Give the parts a test cares about; the rest answer nothing (a spent
 * script throws, as the kit's fakes do).
 */
export interface MemoryKitOptions {
  readonly host?: Partial<LocalixKitPorts['host']>
  /** The workspace trust keys whose dialog was accepted. */
  readonly trusted?: readonly string[]
  /** The plugin directories by absolute path, for `marketplace.directories` and `staged`. */
  readonly directories?: Readonly<Record<string, PluginFiles>>
}

function memoryEnvFiles(): EnvFileStore & { readonly files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    path: async (sessionId, kind) => `/${sessionId}/${kind}-env.sh`,
    read: async (path) => files.get(path),
    clear: async (sessionId, kind) => void files.set(`/${sessionId}/${kind}-env.sh`, ''),
  }
}

function memoryState(): PluginStateStore & { readonly files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    read: async (name) => files.get(name),
    write: async (name, text) => void files.set(name, text),
    names: async () => [...files.keys()].toSorted(),
    modifiedAt: async (name) => (files.has(name) ? 0 : undefined),
    remove: async (name) => void files.delete(name),
  }
}

export function memoryKitPorts(options: MemoryKitOptions = {}): LocalixKitPorts {
  const directories = options.directories ?? {}
  const open = async (path: string) => directories[path]
  const staged: StagedDirectory = {
    open,
    commit: async () => undefined,
    remove: async () => undefined,
  }
  const trusted = new Set(options.trusted ?? [])
  return {
    host: {
      commands: scriptedRunner(),
      locations: locations(),
      environment: fakeEnvironment(),
      http: recordingHttp(),
      mcp: fakeMcp(),
      models: fakeModel(),
      scratch: memoryScratch(),
      clock: fixedClock(),
      folders: folderScan({}),
      ...options.host,
    },
    envFiles: memoryEnvFiles(),
    trust: { isFolderTrusted: async (key) => trusted.has(key) },
    paths: { realpath: async (path) => path },
    bundles: () => ({ open: async () => undefined }),
    marketplace: {
      sha256: { hex: async (bytes) => createHash('sha256').update(bytes).digest('hex') },
      archives: { scan: async () => ({ entries: [] }) },
      tags: { list: async () => [] },
      state: memoryState(),
      directories: { open },
      staged,
    },
  }
}
