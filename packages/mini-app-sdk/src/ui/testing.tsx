/**
 * Host stand-ins for a plugin's own tests.
 *
 * A plugin renders host-owned surfaces — the problem line, the file tab, the data grid — through a
 * binding the application installs at boot. A plugin's unit test has no application, so every plugin
 * that tests a failure surface has to bind something. Three of them wrote the same twenty lines
 * independently, each casting `as never` to get past the components it did not care about, which is
 * how a partial binding hides the day a real one goes missing.
 *
 * So the SDK supplies it. The doubles render the FACTS a surface asserts on — the headline, the
 * recovery links, the way into the centre — and nothing else: a test that passes against a stub
 * prettier than the real thing is a test that proves nothing.
 */

import { createElement } from 'react'

import { bindPluginUiComponents, type PluginUiComponents } from './components'
import type { PluginUiHost } from './host'
import { bindPluginUiToast, type PluginToast } from './notifications'
import { problemReportTitle } from './problems'

const nothing = () => null

/** Every registry on {@link PluginUiHost}, in the order the contract declares them. */
export type PluginUiHostRegistry = keyof PluginUiHost

/** What a {@link recordingPluginUiHost} saw, keyed by registry. */
export type PluginUiRegistrations = Record<PluginUiHostRegistry, unknown[]>

/**
 * A {@link PluginUiHost} that records rather than renders, for a `registerUi` test.
 *
 * The point is that it is COMPLETE. A hand-rolled fixture enumerates the registries its plugin
 * happens to use and casts past the rest, so the day a seam is added to the contract every such
 * fixture stops compiling — the failure lands on plugins that never asked for the seam, far from
 * the change that caused it. Here the `satisfies` is checked once, in the package that owns the
 * contract, and a plugin's test only ever reads `registrations`.
 *
 * Each entry is the argument list of one `register` call, so a test can assert on order, count and
 * payload: `host.registrations.workItems.map((c) => c.kind)`.
 */
export function recordingPluginUiHost(): {
  host: PluginUiHost
  registrations: PluginUiRegistrations
} {
  const registrations: PluginUiRegistrations = {
    workItems: [],
    railSections: [],
    railViewlets: [],
    search: [],
    anchors: [],
    locations: [],
    resourceRefIcons: [],
    fileIcons: [],
    fileEditors: [],
    fileFormats: [],
    sessionEvents: [],
    workItemSlots: [],
    sessionSurfaces: [],
    fileEditorEnhancers: [],
    fileTreeDecorations: [],
    statusItems: [],
    toolCards: [],
    commentActions: [],
    actions: [],
  }
  const record =
    (registry: PluginUiHostRegistry) =>
    (...args: unknown[]) => {
      registrations[registry].push(args.length > 1 ? args : args[0])
    }

  const host = {
    workItems: { register: record('workItems') },
    railSections: { register: record('railSections') },
    railViewlets: { register: record('railViewlets') },
    search: { register: record('search') },
    // `anchors` and `locations` answer whether the claim was accepted; a recording host accepts
    // everything, so a plugin that branches on the answer takes its happy path.
    anchors: { register: (contribution: unknown) => (record('anchors')(contribution), true) },
    locations: { register: (contribution: unknown) => (record('locations')(contribution), true) },
    resourceRefIcons: { register: record('resourceRefIcons') },
    fileIcons: { register: record('fileIcons') },
    fileEditors: { register: record('fileEditors') },
    fileFormats: { register: record('fileFormats') },
    sessionEvents: { register: record('sessionEvents') },
    workItemSlots: { register: record('workItemSlots') },
    sessionSurfaces: { register: record('sessionSurfaces') },
    fileEditorEnhancers: { register: record('fileEditorEnhancers') },
    fileTreeDecorations: { register: record('fileTreeDecorations') },
    statusItems: { register: record('statusItems') },
    toolCards: { register: record('toolCards') },
    commentActions: { register: record('commentActions') },
    actions: { register: record('actions') },
  } satisfies PluginUiHost

  return { host, registrations }
}

/**
 * Bind every host UI contract to a test double.
 *
 * Call it ONCE from the plugin's test preload. A suite that also imports the real host runtime
 * rebinds afterwards and must win — which is why this is not a per-test `beforeEach` by default:
 * re-binding between tests replaces the real editor and grid such a suite depends on.
 *
 * A SUITE that binds them itself calls the returned unbind in `afterAll`. The combined
 * `bun test plugins` run loads no plugin preload and shares one process, so a suite's doubles
 * that outlive it become the next plugin's host: its real grid renders as the stub. The unbind
 * restores whatever the suite shadowed.
 */
export function bindPluginUiTestDoubles(): () => void {
  const problemShape =
    (shape: 'line' | 'state'): PluginUiComponents['ProblemLine'] =>
    ({ report, actions }) =>
      report.problems.length
        ? createElement(
            'div',
            // The shape is the host's to draw; a test can still assert WHICH one a surface chose.
            { role: 'alert', 'data-problem-shape': shape },
            createElement('p', null, problemReportTitle(report)),
            createElement('button', { type: 'button' }, 'Details'),
            // Recovery is data on the report, and the real line renders ALL of it —
            // `durable:false` only withholds it from the Event Center row, never the surface.
            ...(actions ?? []).map((action) =>
              createElement(
                'button',
                { key: action.id, type: 'button', onClick: () => void action.run() },
                action.label,
              ),
            ),
          )
        : null
  const components: PluginUiComponents = {
    FileTab: nothing,
    TableGrid: nothing,
    ContextBindingIcon: nothing,
    ContextBindingPreview: nothing,
    Input: nothing,
    Textarea: nothing,
    ProblemLine: problemShape('line'),
    // The pane shape renders the same title and the same ways out; a test asserts on those.
    ProblemState: problemShape('state'),
  }
  const unbindComponents = bindPluginUiComponents(components)

  const noop = (() => undefined) as unknown as PluginToast
  const unbindToast = bindPluginUiToast(
    Object.assign(noop, {
      success: noop,
      error: noop,
      info: noop,
      warning: noop,
      message: noop,
      // A stable id, so a test can assert that the line was given one to point at.
      problems: () => 'test-entry',
      problemsCleared: () => undefined,
    }) as PluginToast,
  )
  return () => {
    unbindToast()
    unbindComponents()
  }
}
