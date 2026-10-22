import type { ClaudePluginManifest, CommandEntry } from './manifest'

/** Where the manifest lives, relative to the plugin root. Nothing else loads from this folder. */
export const MANIFEST_DIR = '.claude-plugin'
export const MANIFEST_FILE = `${MANIFEST_DIR}/plugin.json`
export const MARKETPLACE_FILE = `${MANIFEST_DIR}/marketplace.json`

/** Each component's default location, relative to the plugin root. */
export const DEFAULT_LOCATIONS = {
  skills: 'skills',
  /** A root `SKILL.md` is one skill, when there is no `skills/` folder and no `skills` key. */
  rootSkill: 'SKILL.md',
  commands: 'commands',
  agents: 'agents',
  hooks: 'hooks/hooks.json',
  mcpServers: '.mcp.json',
  lspServers: '.lsp.json',
  outputStyles: 'output-styles',
  workflows: 'workflows',
  themes: 'themes',
  monitors: 'monitors/monitors.json',
  bin: 'bin',
  settings: 'settings.json',
} as const

/**
 * A folder is a plugin without a manifest when one of these is present: the plugin is then named
 * after the folder.
 */
export const COMPONENT_MARKERS: readonly string[] = [
  MANIFEST_FILE,
  DEFAULT_LOCATIONS.skills,
  DEFAULT_LOCATIONS.rootSkill,
  DEFAULT_LOCATIONS.commands,
  DEFAULT_LOCATIONS.agents,
  DEFAULT_LOCATIONS.hooks,
  DEFAULT_LOCATIONS.mcpServers,
  DEFAULT_LOCATIONS.lspServers,
  DEFAULT_LOCATIONS.monitors,
]

/** Folder components: the listed paths, and whether the default folder is scanned as well. */
export interface FolderSource {
  paths: string[]
  includeDefault: boolean
}

/** File components that merge: the default file (when present) first, then each listed entry. */
export interface MergedSource {
  /** Listed files, in order. */
  files: string[]
  /** Inline maps, in order. */
  inline: Record<string, unknown>[]
}

export interface ComponentSources {
  skills: FolderSource
  commands: FolderSource & { entries: Record<string, CommandEntry> }
  agents: FolderSource
  outputStyles: FolderSource
  workflows: FolderSource
  themes: FolderSource
  hooks: MergedSource
  mcpServers: MergedSource
  lspServers: MergedSource
  /** A listed file or inline array replaces `monitors/monitors.json`. */
  monitors: { file?: string; inline?: unknown[] }
}

const list = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/** `skills` adds to the default folder; the other folder fields replace it when set. */
const adds = (value: string | string[] | undefined): FolderSource => ({
  paths: list(value),
  includeDefault: true,
})
const replaces = (value: string | string[] | undefined): FolderSource => ({
  paths: list(value),
  includeDefault: value === undefined,
})

function merged(value: unknown): MergedSource {
  const entries = value === undefined ? [] : Array.isArray(value) ? value : [value]
  return {
    files: entries.filter((entry): entry is string => typeof entry === 'string'),
    inline: entries.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry),
    ),
  }
}

/**
 * How each component field combines with its default location, per Claude Code: `skills` add to
 * `skills/`; `commands`, `agents`, `outputStyles`, `workflows` and `themes` replace their folder;
 * `hooks`, `mcpServers` and `lspServers` merge with their default file, which loads first;
 * `monitors` replace `monitors/monitors.json`. The `commands` object map replaces the folder too.
 */
export function componentSources(manifest: Partial<ClaudePluginManifest>): ComponentSources {
  const commands = manifest.commands
  const commandMap =
    commands && typeof commands === 'object' && !Array.isArray(commands) ? commands : undefined
  const monitors = manifest.experimental?.monitors ?? manifest.monitors
  return {
    skills: adds(manifest.skills),
    commands: {
      ...replaces(commandMap ? [] : (commands as string | string[] | undefined)),
      includeDefault: commands === undefined,
      entries: commandMap ?? {},
    },
    agents: replaces(manifest.agents),
    outputStyles: replaces(manifest.outputStyles),
    workflows: replaces(manifest.workflows),
    themes: replaces(manifest.experimental?.themes ?? manifest.themes),
    hooks: merged(manifest.hooks),
    mcpServers: merged(manifest.mcpServers),
    lspServers: merged(manifest.lspServers),
    monitors:
      typeof monitors === 'string' ? { file: monitors } : monitors ? { inline: monitors } : {},
  }
}
