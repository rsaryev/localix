/**
 * Host stand-ins for a mini app's own tests.
 *
 * A mini app renders host-owned surfaces — the problem line, the file tab, the data grid — through
 * a binding the application installs at boot. A mini app's unit test has no application, so every
 * mini app that tests a failure surface has to bind something. Three of them wrote the same twenty
 * lines independently, each casting `as never` to get past the components it did not care about,
 * which is how a partial binding hides the day a real one goes missing.
 *
 * So the SDK supplies it. The doubles render the FACTS a surface asserts on — the headline, the
 * recovery links, the way into the centre — and nothing else: a test that passes against a stub
 * prettier than the real thing is a test that proves nothing.
 */

import { createElement } from 'react'

import { bindMiniAppUiComponents, type MiniAppUiComponents } from './components'
import type { MiniAppUiHost } from './host'
import { bindMiniAppUiToast, type MiniAppToast } from './notifications'
import { problemReportTitle } from './problems'

const nothing = () => null

/** Every registry on {@link MiniAppUiHost}, in the order the contract declares them. */
export type MiniAppUiHostRegistry = keyof MiniAppUiHost

/** What a {@link recordingMiniAppUiHost} saw, keyed by registry. */
export type MiniAppUiRegistrations = Record<MiniAppUiHostRegistry, unknown[]>

/**
 * A {@link MiniAppUiHost} that records rather than renders, for a `registerUi` test.
 *
 * The point is that it is COMPLETE. A hand-rolled fixture enumerates the registries its mini app
 * happens to use and casts past the rest, so the day a seam is added to the contract every such
 * fixture stops compiling — the failure lands on mini apps that never asked for the seam, far from
 * the change that caused it. Here the `satisfies` is checked once, in the package that owns the
 * contract, and a mini app's test only ever reads `registrations`.
 *
 * Each entry is the argument list of one `register` call, so a test can assert on order, count and
 * payload: `host.registrations.workItems.map((c) => c.kind)`.
 */
export function recordingMiniAppUiHost(): {
  host: MiniAppUiHost
  registrations: MiniAppUiRegistrations
} {
  const registrations: MiniAppUiRegistrations = {
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
    (registry: MiniAppUiHostRegistry) =>
    (...args: unknown[]) => {
      registrations[registry].push(args.length > 1 ? args : args[0])
    }

  const host = {
    workItems: { register: record('workItems') },
    railSections: { register: record('railSections') },
    railViewlets: { register: record('railViewlets') },
    search: { register: record('search') },
    // `anchors` and `locations` answer whether the claim was accepted; a recording host accepts
    // everything, so a mini app that branches on the answer takes its happy path.
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
  } satisfies MiniAppUiHost

  return { host, registrations }
}

/**
 * Bind every host UI contract to a test double.
 *
 * Call it ONCE from the mini app's test preload. A suite that also imports the real host runtime
 * rebinds afterwards and must win — which is why this is not a per-test `beforeEach` by default:
 * re-binding between tests replaces the real editor and grid such a suite depends on.
 *
 * A SUITE that binds them itself calls the returned unbind in `afterAll`. The combined
 * `bun test mini-apps` run loads no mini app preload and shares one process, so a suite's doubles
 * that outlive it become the next mini app's host: its real grid renders as the stub. The unbind
 * restores whatever the suite shadowed.
 */
export function bindMiniAppUiTestDoubles(): () => void {
  const problemShape =
    (shape: 'line' | 'state'): MiniAppUiComponents['ProblemLine'] =>
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
  const components: MiniAppUiComponents = {
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
  const unbindComponents = bindMiniAppUiComponents(components)

  const noop = (() => undefined) as unknown as MiniAppToast
  const unbindToast = bindMiniAppUiToast(
    Object.assign(noop, {
      success: noop,
      error: noop,
      info: noop,
      warning: noop,
      message: noop,
      // A stable id, so a test can assert that the line was given one to point at.
      problems: () => 'test-entry',
      problemsCleared: () => undefined,
    }) as MiniAppToast,
  )
  return () => {
    unbindToast()
    unbindComponents()
  }
}
