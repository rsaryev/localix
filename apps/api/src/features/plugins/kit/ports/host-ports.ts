import type { EnvFileStore, HostPorts } from '@rsaryev/llx-plugin'
import type { McpBundleReader, WorkspaceTrust } from '@rsaryev/llx-plugin/loading'
import type {
  ArchiveReader,
  GitTags,
  PluginDirectories,
  PluginStateStore,
  Sha256,
  StagedDirectory,
} from '@rsaryev/llx-plugin/marketplace'
import type { PathResolver, PermissionClassifier } from '@rsaryev/llx-plugin/rules'
import { lsRemoteTags } from '../../dependency-tags'
import { hostCommandRunner } from './command-runner'
import { diskFolderScan } from './folder-scan'
import { hostLocations, processEnvironment, scratchFolder, systemClock } from './host-io'
import { fetchHttpClient } from './http-client'
import {
  diskPluginDirectories,
  diskPluginStateStore,
  gitTags,
  nodeSha256,
  zipArchiveReader,
} from './marketplace-io'
import { mcpBundleReader } from './mcp-bundle'
import { claudeTrust, realPathResolver, sessionEnvFiles } from './session-files'
import {
  lateMcpCaller,
  lateModelRunner,
  type McpCallByName,
  type ModelBackend,
} from './session-ports'
import { diskStagedDirectory } from './staged-directory'

/**
 * Every port Localix gives `@rsaryev/llx-plugin`, each a thin adapter over what Localix already has.
 * Engines that bootstrap brings up later (MCP clients, the models) and what belongs to the session
 * at hand (its project, its env-file folder) are read through the getters at call time.
 */
export interface HostPortsDeps {
  readonly homeDir: string
  /** The environment a process gets: `childEnv()` in Localix. */
  environment(): NodeJS.ProcessEnv
  projectDir(): string
  pluginRoot(pluginId: string): string
  /** Where installs and their state files live: `~/.localix/plugins`. */
  pluginsRoot(): string
  scratchDir(): string
  /** The folder of the session's `CLAUDE_ENV_FILE` files. */
  envFilesDir(): string
  /** `managedSettingsDir()`, or `undefined` for a machine with no managed settings. */
  readonly managedDirectory: string | undefined
  mcp(): McpCallByName | undefined
  models(): ModelBackend | undefined
  /** The auto mode reviewer; absent, the kit denies what it would have sent for review. */
  readonly classifier?: PermissionClassifier
  readonly fetch?: typeof fetch
  readonly listTags?: (url: string) => Promise<readonly string[]>
  /** Each stream of a process run is captured up to this many bytes (default 4 MiB). */
  readonly maxOutputBytes?: number
}

export interface LocalixKitPorts {
  /** For `createPluginHost({ ports })`. */
  readonly host: Required<
    Pick<HostPorts, 'clock' | 'folders' | 'http' | 'mcp' | 'models' | 'scratch'>
  > &
    HostPorts
  /** For `createPluginHost({ envFiles })`. */
  readonly envFiles: EnvFileStore
  readonly trust: WorkspaceTrust
  readonly paths: PathResolver
  readonly classifier?: PermissionClassifier
  /** For `loadPlugin({ bundles })`: the bundles of the plugin at `pluginRoot`. */
  bundles(pluginRoot: string): McpBundleReader
  readonly marketplace: {
    readonly sha256: Sha256
    readonly archives: ArchiveReader
    readonly tags: GitTags
    readonly state: PluginStateStore
    readonly directories: PluginDirectories
    readonly staged: StagedDirectory
  }
}

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export function createHostPorts(deps: HostPortsDeps): LocalixKitPorts {
  return {
    host: {
      commands: hostCommandRunner({
        maxOutputBytes: deps.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      }),
      locations: hostLocations(deps),
      environment: processEnvironment(() => deps.environment()),
      http: fetchHttpClient(deps.fetch),
      mcp: lateMcpCaller(() => deps.mcp()),
      models: lateModelRunner(() => deps.models()),
      scratch: scratchFolder(() => deps.scratchDir()),
      clock: systemClock,
      folders: diskFolderScan({ managedDirectory: deps.managedDirectory }),
    },
    envFiles: sessionEnvFiles(() => deps.envFilesDir()),
    trust: claudeTrust({ homeDir: deps.homeDir, env: () => deps.environment() }),
    paths: realPathResolver,
    ...(deps.classifier === undefined ? {} : { classifier: deps.classifier }),
    bundles: mcpBundleReader,
    marketplace: {
      sha256: nodeSha256,
      archives: zipArchiveReader,
      tags: gitTags(deps.listTags ?? lsRemoteTags),
      state: diskPluginStateStore(() => deps.pluginsRoot()),
      directories: diskPluginDirectories,
      staged: diskStagedDirectory,
    },
  }
}
