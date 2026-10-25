import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerFile } from '@localixai/testing'

import { assertNotVoid } from '../../lib/source-lint'
import { actionFor } from '../capabilities/resolve'
import { miniAppTrustClass } from './catalog'
import { resolveMiniAppConfig } from './config'
import { normalizeMiniAppSurfaces } from './contracts-base'
import { discoverBundledMiniApps, type DiscoveredMiniApp } from './discovery'
import { inspectMiniAppTools } from './native'
import { miniAppConfigFields } from './records'

// The first run transpiles every bundled backend: seconds under a parallel run, not milliseconds.
setDefaultTimeout(30_000)

/**
 * BEHAVIOUR BASELINE for the bundled mini apps: what each one gives a person and the model, as
 * discovery and the native loader report it today, pinned in a committed fixture.
 *
 * Most changes to the modules these facts come from must change nothing a person can notice.
 * This fixture is how a change proves it: a diff here is either the intended change or a
 * regression. Change the fixture only for an intended difference, and say which in the commit:
 *
 *   UPDATE_BUNDLED_BASELINE=1 bun test apps/api/src/features/mini-apps/bundled-catalog-baseline
 *   node_modules/.bin/oxfmt --write apps/api/src/features/mini-apps/fixtures/bundled-catalog-baseline.json
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
  commands: BaselineCommand[]
  tools: string[]
  views: string[]
  promptSections: string[]
  config: string[]
}

type Baseline = Record<string, BaselineEntry>

const sorted = (values: Iterable<string>): string[] => [...values].sort()

function commandsOf(app: DiscoveredMiniApp): BaselineCommand[] {
  return app.commands
    .map((command) => ({
      name: command.name,
      args: command.args.map((arg) => arg.name),
      ...(command.featured !== undefined ? { featured: command.featured } : {}),
      ...(command.activateTools ? { activateTools: [...command.activateTools] } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function entryOf(app: DiscoveredMiniApp, tools: string[]): BaselineEntry {
  return {
    category: app.manifest?.category ?? null,
    surfaces: normalizeMiniAppSurfaces(app.manifest?.surfaces),
    trust: miniAppTrustClass(app),
    ruleKey: actionFor('mini-app', app.name),
    commands: commandsOf(app),
    tools: sorted(tools),
    views: sorted(app.views.map((view) => view.id)),
    promptSections: app.promptSections.map((section) => section.title),
    config: miniAppConfigFields(app, undefined).map((field) => field.key),
  }
}

/** Every bundled mini app's entry, by name, plus the inspections that failed. */
async function currentBaseline(homeDir: string): Promise<{ baseline: Baseline; errors: string[] }> {
  const apps = await discoverBundledMiniApps()
  assertNotVoid(
    'bundled mini apps',
    apps.length,
    'discoverBundledMiniApps() reads the bundled root — check its location and layout.',
  )
  const errors: string[] = []
  const entries = await Promise.all(
    apps.map(async (app) => {
      const inspection =
        app.backendEntries.length > 0
          ? await inspectMiniAppTools(app, resolveMiniAppConfig(app.manifest?.config, undefined), {
              userId: 'bundled-baseline',
              cwd: app.dir,
              homeDir,
            })
          : null
      if (app.error) errors.push(`${app.name}: ${app.error}`)
      if (inspection?.error) errors.push(`${app.name}: ${inspection.error}`)
      const tools = inspection?.tools.map((tool) => tool.name) ?? []
      return [app.name, entryOf(app, tools)] as const
    }),
  )
  return { baseline: Object.fromEntries(entries), errors }
}

/** One line per difference: a mini app added or gone, or a field that changed. */
function driftLines(expected: Baseline, actual: Baseline): string[] {
  const lines: string[] = []
  for (const name of sorted(new Set([...Object.keys(expected), ...Object.keys(actual)]))) {
    const before = expected[name]
    const after = actual[name]
    if (!before) lines.push(`${name}: new bundled mini app`)
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

describe('bundled mini app baseline', () => {
  // Inspection builds each backend's real context, which creates its folders: never the real home.
  const home = tempDirPerFile('bundled-baseline-home')
  let current: ReturnType<typeof currentBaseline> | undefined
  const inspectOnce = () => (current ??= currentBaseline(home()))

  test('every bundled mini app loads without an error', async () => {
    const { errors } = await inspectOnce()
    expect(errors).toEqual([])
  })

  test('what each bundled mini app provides matches the committed baseline', async () => {
    const { baseline } = await inspectOnce()
    if (UPDATE) writeFileSync(FIXTURE, `${JSON.stringify(baseline, null, 2)}\n`)
    const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline
    const drift = driftLines(recorded, baseline)
    // Each line names the mini app and field; regenerate only for an intended change (see top).
    expect(drift).toEqual([])
  })

  test('the drift report names each kind of difference', () => {
    const entry = (tools: string[]): BaselineEntry => ({
      category: 'games',
      surfaces: ['agent'],
      trust: 'bundled',
      ruleKey: 'mini-app:a',
      commands: [],
      tools,
      views: [],
      promptSections: [],
      config: [],
    })
    expect(
      driftLines({ a: entry(['x']), gone: entry([]) }, { a: entry(['y']), added: entry([]) }),
    ).toEqual([
      'a.tools: ["x"] -> ["y"]',
      'added: new bundled mini app',
      'gone: no longer discovered',
    ])
  })
})
