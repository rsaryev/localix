import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerFile } from '@localixai/testing'

import { assertNotVoid } from '../../lib/source-lint'
import { actionFor } from '../capabilities/resolve'
import { resolvePluginConfig } from './config'
import { normalizePluginSurfaces } from './contracts-base'
import { discoverBundledPlugins, type DiscoveredPlugin } from './discovery'
import { pluginTrustClass } from './enable'
import { inspectPluginTools } from './native'
import { toConfigFields } from './service-types'

// The first run transpiles every bundled backend: seconds under a parallel run, not milliseconds.
setDefaultTimeout(30_000)

/**
 * BEHAVIOUR BASELINE for the bundled extensions: what each one gives a person and the model, as
 * discovery and the native loader report it today, pinned in a committed fixture.
 *
 * Separating Claude Code plugins from mini apps moves almost every module these facts come
 * from, and most of those steps must change nothing a person can notice. This fixture is how a
 * step proves it: a diff here is either the step's intended change or a regression. Change the
 * fixture only for an intended difference, and say which in the commit:
 *
 *   UPDATE_BUNDLED_BASELINE=1 bun test apps/api/src/features/plugins/bundled-catalog-baseline
 *   node_modules/.bin/oxfmt --write apps/api/src/features/plugins/fixtures/bundled-catalog-baseline.json
 *
 * Tools come from importing each backend with no host services, the way the architecture check
 * and the surface contract inspect them; a backend that registers its tools only with a host
 * service lists none here.
 */
const FIXTURE = join(import.meta.dir, 'fixtures', 'bundled-catalog-baseline.json')
const UPDATE = process.env.UPDATE_BUNDLED_BASELINE === '1'

interface BaselineCommand {
  name: string
  args: string[]
  featured?: boolean
  activateTools?: string[]
}

interface BaselineEntry {
  category: string | null
  surfaces: string[]
  trust: string
  ruleKey: string
  skills: string[]
  commands: BaselineCommand[]
  agents: string[]
  contributions: string[]
  tools: string[]
  views: string[]
  promptSections: string[]
  config: string[]
}

type Baseline = Record<string, BaselineEntry>

const sorted = (values: Iterable<string>): string[] => [...values].sort()

function commandsOf(plugin: DiscoveredPlugin): BaselineCommand[] {
  return plugin.commands
    .map((command) => ({
      name: command.name,
      args: (command.args ?? []).map((arg) => arg.name),
      ...(command.featured !== undefined ? { featured: command.featured } : {}),
      ...(command.activateTools ? { activateTools: [...command.activateTools] } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function entryOf(plugin: DiscoveredPlugin, tools: string[]): BaselineEntry {
  const { manifest } = plugin
  return {
    category: manifest.category ?? null,
    surfaces: normalizePluginSurfaces(manifest.surfaces),
    trust: pluginTrustClass(plugin),
    ruleKey: actionFor('plugin', manifest.name),
    skills: sorted(plugin.provides.skills),
    commands: commandsOf(plugin),
    agents: sorted(plugin.provides.agents ?? []),
    contributions: sorted((manifest.contributions ?? []).map((item) => `${item.kind}:${item.key}`)),
    tools: sorted(tools),
    views: sorted((manifest.views ?? []).map((view) => view.id)),
    promptSections: (manifest.promptSections ?? []).map((section) => section.title),
    config: toConfigFields(plugin, undefined).map((field) => field.key),
  }
}

/** Every bundled extension's entry, by name, plus the inspections that failed. */
async function currentBaseline(homeDir: string): Promise<{ baseline: Baseline; errors: string[] }> {
  const plugins = await discoverBundledPlugins()
  assertNotVoid(
    'bundled extensions',
    plugins.length,
    'discoverBundledPlugins() reads the bundled root — check its location and layout.',
  )
  const errors: string[] = []
  const entries = await Promise.all(
    plugins.map(async (plugin) => {
      const inspection = plugin.provides.hasNativeTools
        ? await inspectPluginTools(plugin, resolvePluginConfig(plugin.manifest, undefined), {
            userId: 'bundled-baseline',
            cwd: plugin.dir,
            homeDir,
          })
        : null
      if (plugin.error) errors.push(`${plugin.manifest.name}: ${plugin.error}`)
      if (inspection?.error) errors.push(`${plugin.manifest.name}: ${inspection.error}`)
      const tools = inspection?.tools.map((tool) => tool.name) ?? []
      return [plugin.manifest.name, entryOf(plugin, tools)] as const
    }),
  )
  return { baseline: Object.fromEntries(entries), errors }
}

/** One line per difference: an extension added or gone, or a field that changed. */
function driftLines(expected: Baseline, actual: Baseline): string[] {
  const lines: string[] = []
  for (const name of sorted(new Set([...Object.keys(expected), ...Object.keys(actual)]))) {
    const before = expected[name]
    const after = actual[name]
    if (!before) lines.push(`${name}: new bundled extension`)
    else if (!after) lines.push(`${name}: no longer discovered`)
    else {
      const fields = new Set([...Object.keys(before), ...Object.keys(after)])
      for (const field of fields) {
        const was = JSON.stringify(before[field as keyof BaselineEntry])
        const now = JSON.stringify(after[field as keyof BaselineEntry])
        if (was !== now) lines.push(`${name}.${field}: ${was} -> ${now}`)
      }
    }
  }
  return lines
}

describe('bundled extension baseline', () => {
  // Inspection builds each backend's real context, which creates its folders: never the real home.
  const home = tempDirPerFile('bundled-baseline-home')
  let current: ReturnType<typeof currentBaseline> | undefined
  const inspectOnce = () => (current ??= currentBaseline(home()))

  test('every bundled extension loads without an error', async () => {
    const { errors } = await inspectOnce()
    expect(errors).toEqual([])
  })

  test('what each bundled extension provides matches the committed baseline', async () => {
    const { baseline } = await inspectOnce()
    if (UPDATE) writeFileSync(FIXTURE, `${JSON.stringify(baseline, null, 2)}\n`)
    const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline
    const drift = driftLines(recorded, baseline)
    // Each line names the extension and field; regenerate only for an intended change (see top).
    expect(drift).toEqual([])
  })

  test('the drift report names each kind of difference', () => {
    const entry = (tools: string[]): BaselineEntry => ({
      category: 'games',
      surfaces: ['agent'],
      trust: 'bundled',
      ruleKey: 'plugin:a',
      skills: [],
      commands: [],
      agents: [],
      contributions: [],
      tools,
      views: [],
      promptSections: [],
      config: [],
    })
    expect(
      driftLines({ a: entry(['x']), gone: entry([]) }, { a: entry(['y']), added: entry([]) }),
    ).toEqual([
      'a.tools: ["x"] -> ["y"]',
      'added: new bundled extension',
      'gone: no longer discovered',
    ])
  })
})
