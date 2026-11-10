import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeTree } from '@localixai/testing'
import type { EnvFileStore, HooksSettings, PluginFiles, PluginSession } from '@rsaryev/llx-plugin'
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
import { createLocalixPluginHost, type LocalixPluginHost } from './host'
import { createKitHooksRuntime } from './hooks/runtime'
import { createChatPluginSessions, type ScopePlugin } from './sessions'
import { readPluginFolder } from './catalog/read-folder'
import type { CcHooksRuntime } from '../../cc-hooks/runtime-contracts'
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

/** A real plugin host over a home folder on disk, for tests that read plugins from folders. */
export function diskPluginHost(
  homeDir: string,
  options: { readonly managedDirectory?: string; readonly env?: NodeJS.ProcessEnv } = {},
): LocalixPluginHost {
  return createLocalixPluginHost({
    homeDir,
    environment: () => ({ PATH: process.env.PATH, ...options.env }),
    pluginsRoot: () => join(homeDir, '.localix/plugins'),
    scratchDir: () => join(homeDir, 'scratch'),
    envFilesDir: (sessionId) => join(homeDir, 'sessions', sessionId),
    managedDirectory: options.managedDirectory,
    mcp: () => undefined,
    models: () => undefined,
  })
}

/** A chat's kit session whose user settings hold `hooks`, in the trusted folder `cwd`. */
export function hookTestSession(homeDir: string, cwd: string, hooks: HooksSettings): PluginSession {
  return createChatPluginSessions(diskPluginHost(homeDir)).forRun({
    chatId: 'chat-1',
    cwd,
    transcriptPath: join(homeDir, 'chat-1.jsonl'),
    permissionMode: 'default',
    trusted: true,
    layers: [{ scope: 'user', settings: { hooks } }],
    plugins: [],
  })
}

/** The hooks of such a session as the chat runtime calls them, outside a run. */
export function hookTestRuntime(
  homeDir: string,
  cwd: string,
  hooks: HooksSettings,
): CcHooksRuntime {
  return createKitHooksRuntime(hookTestSession(homeDir, cwd, hooks), { cwd })
}

/**
 * A chat's kit session in the trusted folder `cwd` (its `.claude/skills` and `~/.claude/skills`
 * under `homeDir`), with the plugins read from `pluginDirs` as user installs the agent selected,
 * each `<name>@test`.
 */
export async function skillTestSession(
  homeDir: string,
  cwd: string,
  pluginDirs: readonly string[] = [],
): Promise<PluginSession> {
  const plugins = await Promise.all(pluginDirs.map((dir) => testScopePlugin(dir)))
  return createChatPluginSessions(diskPluginHost(homeDir)).forRun({
    chatId: 'chat-1',
    cwd,
    transcriptPath: join(homeDir, 'chat-1.jsonl'),
    permissionMode: 'default',
    trusted: true,
    layers: [],
    plugins,
  })
}

/** A plugin folder read as a user install of the scope, `<name>@test`. */
export async function testScopePlugin(dir: string, selected = true): Promise<ScopePlugin> {
  const read = await readPluginFolder(dir)
  if (!read.kit) throw new Error(`${dir} does not load as a plugin`)
  return {
    id: `${read.manifest.name}@test`,
    root: dir,
    plugin: read.kit,
    selected,
    scope: 'user',
    values: {},
  }
}

/** A plugin `name` written afresh at `dir` with these files beside its manifest, read as installed. */
export async function writeTestPlugin(
  dir: string,
  name: string,
  files: Readonly<Record<string, string>>,
  selected = true,
): Promise<ScopePlugin> {
  rmSync(dir, { recursive: true, force: true })
  writeTree(dir, { '.claude-plugin/plugin.json': JSON.stringify({ name }), ...files })
  return testScopePlugin(dir, selected)
}
