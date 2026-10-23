import {
  miniAppNotificationCallSite,
  type MiniAppProblemsOptions,
  type MiniAppToast,
  type MiniAppToastId,
  type MiniAppToastOptions,
} from '@localixai/mini-app-sdk/ui'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

import { attributeMiniAppCaller, pluginLabel } from './miniAppAttribution'

/**
 * The toast the host lends plugins: its own, with each row named after the plugin that made it.
 *
 * Handing plugins the host's `toast` directly filed every plugin row as "System" (see
 * `miniAppAttribution.ts`). This wrapper answers "which plugin" per call and passes the answer as the
 * row's `source` label — a label on whatever origin the row would get anyway, never a different
 * origin, so a row still files under the chat it happened in. A call nothing can attribute is
 * published exactly as before.
 */

type Method = 'success' | 'error' | 'info' | 'warning' | 'message'

type Publish = (
  message: string,
  options?: MiniAppToastOptions & { source?: string },
) => MiniAppToastId

/** The slice of the host publisher (`shared/lib/notify.ts`) this wrapper forwards to. */
export interface AttributableToast extends Publish, Record<Method, Publish> {
  problems: (
    report: ProblemReport,
    options: MiniAppProblemsOptions & { source?: string },
  ) => string | undefined
  problemsCleared: (subject: Pick<ProblemReport, 'subject'>, scope: string) => void
  acknowledgeInline?: (error?: unknown) => void
}

/**
 * The stack to attribute: the call site an SDK helper recorded for a deferred publish, else the
 * live one. Taken HERE, inside the wrapper, so the frames above it are the SDK's and the plugin's.
 */
const callerStack = (): string =>
  miniAppNotificationCallSite() ?? new Error('plugin notification call site').stack ?? ''

export function createPluginToast(
  host: AttributableToast,
  stack: () => string = callerStack,
): MiniAppToast {
  const sourceOf = () => attributeMiniAppCaller(stack())?.label
  // A `source` a plugin slipped into its options is dropped: the name is the host's to give, or a
  // plugin could file its rows under another plugin's name.
  const withSource = (options: MiniAppToastOptions | undefined) => {
    const { source: _claimed, ...rest } = (options ?? {}) as MiniAppToastOptions & {
      source?: unknown
    }
    const source = sourceOf()
    return source ? { ...rest, source } : options && rest
  }
  // Resolved per call, not captured at bind time: the host publisher is bound once at startup, and a
  // captured method would outlive anything that later wraps or replaces it.
  const method =
    (name?: Method): Publish =>
    (message, options) =>
      (name ? host[name] : host)(message, withSource(options))
  const methods = Object.fromEntries(
    (['success', 'error', 'info', 'warning', 'message'] as const).map((name) => [
      name,
      method(name),
    ]),
  ) as Record<Method, Publish>
  return Object.assign(method(), methods, {
    // A report is usually published from the SDK's shared hook, inside a React effect whose stack
    // holds no plugin frame. Its `scope` is the plugin id by contract, which is the next best name.
    problems: (report: ProblemReport, options: MiniAppProblemsOptions) =>
      host.problems(report, { ...options, source: sourceOf() ?? pluginLabel(options.scope) }),
    problemsCleared: (subject: Pick<ProblemReport, 'subject'>, scope: string) =>
      host.problemsCleared(subject, scope),
    acknowledgeInline: (error?: unknown) => host.acknowledgeInline?.(error),
  })
}
