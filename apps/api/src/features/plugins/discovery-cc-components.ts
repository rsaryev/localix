import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'

import {
  componentSources,
  DEFAULT_LOCATIONS,
  outputStyleOf,
  parseTheme,
  parseWorkflowMeta,
  pluginSettingsOf,
  type ClaudePluginManifest,
  type ClaudeTheme,
  type FolderSource,
  type OutputStyle,
  type PluginIssue,
  type PluginSettings,
  type WorkflowMeta,
} from '@localixai/claude-plugin'

import { isPathWithin } from '../../lib/path-containment'
import { parseMarkdownFrontmatter } from '../agent-core/frontmatter-yaml'
import { readSkillMarkdownFile } from '../agent-core/skill-file'
import { toAbsList } from './discovery-paths'
import { readJsonFile } from '../../lib/json'
import type { PluginManifest } from './contracts'

/**
 * The Claude Code components that are files of their own and not commands or agents: output
 * styles (`output-styles/*.md`), color themes (`themes/*.json`), workflows (`workflows/*.js`) and
 * default settings (`settings.json`). Each folder field REPLACES its default folder, as in Claude
 * Code. Only read here; the loader hands enabled plugins' components to their consumers.
 */

/** A plugin workflow: its `meta` and the script that runs as `/<plugin>:<name>`. */
export interface PluginWorkflow extends WorkflowMeta {
  file: string
}

export interface PluginCcComponents {
  outputStyles: OutputStyle[]
  themes: ClaudeTheme[]
  workflows: PluginWorkflow[]
  settings: PluginSettings
  /** What could not be read: reported in the plugin's validation. */
  issues: PluginIssue[]
}

/** Files larger than this are not read: a style, a theme or a workflow is far smaller. */
const MAX_COMPONENT_BYTES = 1024 * 1024
const MAX_FILES_PER_COMPONENT = 64

/** The files with `extension` a folder component names, confined to the plugin directory. */
async function componentFiles(
  dir: string,
  source: FolderSource,
  defaultDir: string,
  extension: string,
): Promise<string[]> {
  const root = await fs.realpath(dir).catch(() => dir)
  const roots = [
    ...toAbsList(dir, source.paths),
    ...(source.includeDefault ? [join(dir, defaultDir)] : []),
  ]
  const files: string[] = []
  for (const path of roots) {
    const real = await fs.realpath(path).catch(() => null)
    if (!real || !isPathWithin(root, real)) continue
    const stat = await fs.stat(real).catch(() => null)
    if (stat?.isFile() && extname(real) === extension) files.push(real)
    if (!stat?.isDirectory()) continue
    const entries = await fs.readdir(real, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)))
      if (entry.isFile() && extname(entry.name) === extension) files.push(join(real, entry.name))
  }
  return [...new Set(files)].slice(0, MAX_FILES_PER_COMPONENT)
}

async function readSmall(file: string): Promise<string | null> {
  const stat = await fs.stat(file).catch(() => null)
  if (!stat || stat.size > MAX_COMPONENT_BYTES) return null
  return fs.readFile(file, 'utf8').catch(() => null)
}

const stem = (file: string) => basename(file, extname(file))

export async function resolveCcComponents(
  dir: string,
  manifest: PluginManifest,
): Promise<PluginCcComponents> {
  const sources = componentSources({
    outputStyles: manifest.outputStyles,
    workflows: manifest.workflows,
    themes: manifest.themes,
  } as Partial<ClaudePluginManifest>)
  const issues: PluginIssue[] = []
  const [styleFiles, themeFiles, workflowFiles, settingsFile] = await Promise.all([
    componentFiles(dir, sources.outputStyles, DEFAULT_LOCATIONS.outputStyles, '.md'),
    componentFiles(dir, sources.themes, DEFAULT_LOCATIONS.themes, '.json'),
    componentFiles(dir, sources.workflows, DEFAULT_LOCATIONS.workflows, '.js'),
    readJsonFile(join(dir, DEFAULT_LOCATIONS.settings)),
  ])

  const outputStyles: OutputStyle[] = []
  for (const file of styleFiles) {
    const raw = await readSkillMarkdownFile(file).catch(() => null)
    if (raw === null) {
      issues.push({ severity: 'error', path: file, message: 'Cannot read the output style' })
      continue
    }
    const { fields, body } = parseMarkdownFrontmatter(raw)
    const style = outputStyleOf(stem(file), fields, body)
    if (!outputStyles.some((found) => found.name === style.name)) outputStyles.push(style)
  }

  const themes: ClaudeTheme[] = []
  for (const file of themeFiles) {
    const theme = parseTheme(stem(file), await readJsonFile(file))
    if (theme) themes.push(theme)
    else issues.push({ severity: 'error', path: file, message: 'The theme is not a JSON object' })
  }

  const workflows: PluginWorkflow[] = []
  for (const file of workflowFiles) {
    const source = await readSmall(file)
    const parsed =
      source === null ? { error: 'Cannot read the workflow' } : parseWorkflowMeta(source)
    if (!parsed.meta) issues.push({ severity: 'error', path: file, message: parsed.error })
    else if (!workflows.some((found) => found.name === parsed.meta.name))
      workflows.push({ ...parsed.meta, file })
  }

  const settings = pluginSettingsOf(settingsFile, manifest.settings)
  issues.push(...settings.issues)
  return { outputStyles, themes, workflows, settings: settings.settings, issues }
}
