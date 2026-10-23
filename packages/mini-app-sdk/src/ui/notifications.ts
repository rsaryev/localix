import type { ProblemLocation, ProblemRecovery, ProblemReport } from './problems'
import type { MiniAppApiError } from './transport'

export type MiniAppToastId = string | number

export interface MiniAppToastOptions {
  id?: MiniAppToastId
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  /**
   * The way OUT, beside `action`'s way forward. The host has always rendered it; the SDK simply
   * never declared it, so a plugin offering "Undo" next to "Keep" could not type the pair.
   */
  cancel?: {
    label: string
    onClick: () => void
  }
}

type MiniAppToastMethod = (message: string, options?: MiniAppToastOptions) => MiniAppToastId

export interface MiniAppProblemsOptions {
  /**
   * Namespace for the report's identity — use the plugin id. The host names the row after the
   * calling plugin by itself (see "Attribution" below); when it cannot tell (a report published
   * from a shared hook's effect), this id is the name it falls back to.
   */
  scope: string
  /** True while the plugin's own surface is showing the same report. */
  sourceVisible?: boolean
  /** Opens the subject at a problem; adds an "Open" action to the notification. */
  onOpen?: (location: ProblemLocation) => void
  /**
   * The ways out of this problem. Declared once here and rendered in both places: beside "Details"
   * on the line, and on the durable row — minus any marked `durable: false`.
   */
  actions?: readonly ProblemRecovery[]
}

export interface MiniAppToast extends MiniAppToastMethod {
  success: MiniAppToastMethod
  error: MiniAppToastMethod
  info: MiniAppToastMethod
  warning: MiniAppToastMethod
  message: MiniAppToastMethod
  /**
   * Publish a structured problem report to the host's notification centre.
   *
   * A plugin that renders its own problems on its own surface is only half done — a person not
   * looking at that surface learns nothing. Reporting here as well is what makes a plugin's
   * failures as visible as the host's own.
   */
  problems: (report: ProblemReport, options: MiniAppProblemsOptions) => string | undefined
  /** The subject validates again; settle whatever the centre still says about it. */
  problemsCleared: (subject: Pick<ProblemReport, 'subject'>, scope: string) => void
  /**
   * The plugin shows this failure on its own surface (an error line under a form), so the host's
   * generic "could not …" row for the failed request must not duplicate it. Optional: an older
   * host does not offer it, and {@link acknowledgeInline} degrades to nothing.
   */
  acknowledgeInline?: (error?: unknown) => void
}

/*
 * Attribution. Every plugin shares this one `toast`, so a row the host recorded from it used to be
 * indistinguishable from the host's own: "System", no plugin name. The host therefore attributes
 * each call to the plugin that made it — it matches the calling stack frames against the URLs it
 * loaded each plugin's UI from, the way an editor blames an extension for the error it threw — and
 * files the row under that plugin's name. A plugin passes nothing for this, and cannot claim to be
 * another plugin: the name comes from where the code was loaded, not from anything it says.
 *
 * A call whose stack no longer holds the plugin (a rejection handled on a later microtask) is the
 * one case frames cannot answer, so the helpers here that publish LATER record the plugin's call
 * site when they are called and lend it to the host for the duration of the publish.
 */
let deferredCallSite: string | undefined

/**
 * Host side of attribution: the stack of the plugin call that scheduled the notification being
 * published right now, when the publishing frame itself no longer contains it. Undefined outside
 * such a publish — the host then reads the live stack.
 */
export function miniAppNotificationCallSite(): string | undefined {
  return deferredCallSite
}

function publishFrom(callSite: string | undefined, publish: () => void): void {
  const outer = deferredCallSite
  deferredCallSite = callSite
  try {
    publish()
  } finally {
    deferredCallSite = outer
  }
}

let hostToast: MiniAppToast | undefined

function requireHostToast(): MiniAppToast {
  if (!hostToast) {
    throw new Error('Plugin UI toast used before the host notification surface was bound')
  }
  return hostToast
}

/**
 * Bind the plugin-facing notification surface to the host's notification adapter.
 * The host owns routing, policy and attribution (which plugin a row names — see above); the SDK
 * only preserves the familiar toast call shape. The returned unbind RESTORES the binding this one
 * shadowed — the scope rule every host binding follows (`bindMiniAppUiRuntime`).
 */
export function bindMiniAppUiToast(toast: MiniAppToast): () => void {
  const previous = hostToast
  hostToast = toast
  return () => {
    if (hostToast === toast) hostToast = previous
  }
}

const notify: MiniAppToastMethod = (message, options) => requireHostToast()(message, options)

export const toast: MiniAppToast = Object.assign(notify, {
  success: (message: string, options?: MiniAppToastOptions) =>
    requireHostToast().success(message, options),
  error: (message: string, options?: MiniAppToastOptions) =>
    requireHostToast().error(message, options),
  info: (message: string, options?: MiniAppToastOptions) =>
    requireHostToast().info(message, options),
  warning: (message: string, options?: MiniAppToastOptions) =>
    requireHostToast().warning(message, options),
  message: (message: string, options?: MiniAppToastOptions) =>
    requireHostToast().message(message, options),
  // Problem reporting DEGRADES instead of throwing. Every other method here is called from a
  // working code path, where an unbound host is a real misconfiguration worth failing loudly on.
  // These two are the failure path itself: a surface already reporting something broken must not
  // be brought down by the reporting. It also keeps the shared `useProblemReport` usable in a unit
  // test that renders one component and never boots the host.
  problems: (report: ProblemReport, options: MiniAppProblemsOptions) =>
    hostToast?.problems(report, options),
  problemsCleared: (subject: Pick<ProblemReport, 'subject'>, scope: string) =>
    hostToast?.problemsCleared(subject, scope),
  acknowledgeInline: (error?: unknown) => acknowledgeInline(error),
})

/**
 * Say that a failure is already on the plugin's own surface.
 *
 * Every failed request a plugin makes travels through the host's transport, which writes a generic
 * journal row for it unless the failure is reported within a moment. An inline error line under the
 * control IS that report, but the host cannot see it — so the person got the failure twice: once
 * where they were looking and once as an unread row pointing back at it. Call this where the error
 * is set (`setError(...)`); it degrades to nothing on a host without the capability, like
 * `toast.problems`, because it sits on the failure path itself.
 */
export function acknowledgeInline(error?: unknown): void {
  hostToast?.acknowledgeInline?.(error)
}

/**
 * Run a fire-and-forget action, and SAY SO when it fails.
 *
 * A described menu row's `onSelect` returns `void`, so every asynchronous action behind one has to
 * dispose of its own rejection — and the two shapes a plugin reaches for both lose it. `void
 * promise` leaves an unhandled rejection nobody sees; `promise.catch(() => {})` is worse, because
 * it is deliberate. The reported symptom is the same either way and it is the most confusing one a
 * UI has: the row highlights, the menu closes, and nothing happens, with no way to tell a refused
 * action from a broken one.
 *
 * It happened in three plugins at once — a database that would not connect, a port-forward that
 * would not stop, an environment that would not switch — which is what makes it worth a name
 * rather than three catch blocks.
 *
 * `failure` is the sentence a person reads: what did not happen, in their words. The error's own
 * message goes underneath it, because a backend's phrasing explains but rarely announces.
 *
 * Deliberately returns `void`: the caller is a menu row, and giving it a promise to ignore would
 * re-open the hole this closes.
 */
export function runMiniAppAction(run: () => Promise<unknown> | void, failure: string): void {
  // Recorded NOW, while the plugin's frame is on the stack: the rejection below is handled on a
  // later microtask whose stack holds only this module, which the host cannot attribute.
  const callSite = new Error('plugin action call site').stack
  const report = (error: unknown) =>
    publishFrom(callSite, () => toast.error(failure, { description: describeFailure(error) }))
  try {
    const result = run()
    if (result instanceof Promise) void result.catch(report)
  } catch (error) {
    // A synchronous throw is the same event to the person who clicked; only the stack differs.
    report(error)
  }
}

/**
 * The error's own words, or nothing — the sentence first, the raw detail under it.
 *
 * Only a real message survives. A rejection carrying an object stringifies to `[object Object]`,
 * which is a line of noise under a sentence that was already complete — the caller's `failure` is
 * what the person is meant to read.
 *
 * A {@link MiniAppApiError} also carries `detail`: what the engine, driver or parser actually said.
 * Dropping it left a durable row reading "The server rejected this request." with the one line
 * that named the reason thrown away. The row is the place with room for it (the transport's own
 * rule: `detail` is for the Event Center, never a surface line), so it goes on its own line, once —
 * never repeated when the route echoed the message as its detail.
 */
function describeFailure(error: unknown): string | undefined {
  if (typeof error === 'string') return error.trim() || undefined
  if (!(error instanceof Error)) return undefined
  const message = error.message.trim()
  const detail = detailOf(error)
  const lines = [message, detail && detail !== message ? detail : ''].filter(Boolean)
  return lines.join('\n') || undefined
}

/** `MiniAppApiError.detail`, read structurally so a host error of the same shape counts too. */
function detailOf(error: Error): string {
  const { detail } = error as Partial<Pick<MiniAppApiError, 'detail'>>
  return typeof detail === 'string' ? detail.trim() : ''
}
