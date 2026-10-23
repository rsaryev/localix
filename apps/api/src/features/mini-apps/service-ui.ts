import { localixWorkspaceDir } from '../../lib/env'
import { errorMessage } from '../../lib/errors'
import { ConflictError, NotFoundError, UnavailableError } from '../../lib/domain-errors'
import { scalarConfig } from '../capabilities/source-repository'
import { confineToDir } from '../ext/fs-discovery'
import { parseArgOptions, runArgOptionsScript, type ArgOption } from './arg-options'
import type { MiniAppCatalog } from './catalog'
import { resolveMiniAppConfig } from './config'
import type { InvokeMiniAppUiActionRequest } from './contracts-contributions'
import type { MiniAppServiceDeps } from './service'
import { jsonValueWithinCap } from './ui-action-json'

/**
 * The parts of the mini app service a view and the composer call into: a view's action on its own
 * backend, and a command picker's options. Split from `service.ts` so each stays readable.
 */
export interface MiniAppServiceScope {
  deps: MiniAppServiceDeps
  catalogFor: (userId: string, projectId: string) => Promise<{ catalog: MiniAppCatalog }>
  cwdFor: (userId: string, projectId: string) => Promise<string | null>
}

export interface MiniAppArgOptionsInput {
  app: string
  command: string
  arg: string
  query?: string
  sessionId?: string
  projectId?: string | null
}

/** A view's call into its own backend; the host binds identity, scope and folder. */
export async function invokeMiniAppUiAction(
  { deps, catalogFor, cwdFor }: MiniAppServiceScope,
  userId: string,
  input: InvokeMiniAppUiActionRequest,
) {
  if (!deps.invokeUiAction)
    throw new UnavailableError('mini_app_ui_actions_unavailable', 'UI actions are unavailable')
  const projectId = input.projectId ?? ''
  const { catalog } = await catalogFor(userId, projectId)
  if (!catalog.enabled.some(({ app }) => app.name === input.app && app.projectId === projectId))
    throw new NotFoundError(
      'mini_app_not_enabled',
      `Mini app "${input.app}" is not enabled in this scope`,
    )
  const sessionCwd = input.sessionId
    ? await deps.resolveSessionCwd?.(userId, input.sessionId)
    : null
  if (input.sessionId && !sessionCwd)
    throw new NotFoundError('session_not_found', 'Session not found')
  const projectCwd = projectId ? await cwdFor(userId, projectId) : null
  try {
    const result = await deps.invokeUiAction({
      app: input.app,
      action: input.action,
      payload: jsonValueWithinCap(input.payload, 'UI action payload'),
      context: {
        userId,
        projectId,
        cwd: sessionCwd ?? projectCwd ?? localixWorkspaceDir(),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        viewId: input.viewId,
      },
    })
    return { result: jsonValueWithinCap(result, 'UI action result') }
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    if (code === 'not_available')
      throw new NotFoundError('mini_app_ui_action_not_found', errorMessage(err))
    if (code === 'ambiguous')
      throw new ConflictError('mini_app_ui_action_ambiguous', errorMessage(err))
    if (code === 'timeout')
      throw new UnavailableError('mini_app_ui_action_timeout', errorMessage(err))
    throw err
  }
}

/**
 * A picker's options, from the app's `optionsScript`, run in the session's folder. Only for an
 * enabled app, with the script confined to its folder. Never throws: a failure lists nothing.
 */
export async function resolveMiniAppArgOptions(
  { deps, catalogFor, cwdFor }: MiniAppServiceScope,
  userId: string,
  input: MiniAppArgOptionsInput,
): Promise<{ options: ArgOption[] }> {
  try {
    const projectId = input.projectId ?? ''
    const { catalog } = await catalogFor(userId, projectId)
    const entry = catalog.enabled.find(({ app }) => app.name === input.app)
    const arg = entry?.app.commands
      .find((command) => command.name === input.command)
      ?.args.find((candidate) => candidate.name === input.arg)
    if (!entry || !arg?.optionsScript) return { options: [] }
    const script = confineToDir(entry.app.dir, arg.optionsScript)
    if (!script) return { options: [] }
    const sessionCwd = input.sessionId
      ? await deps.resolveSessionCwd?.(userId, input.sessionId)
      : null
    const cwd = sessionCwd ?? (await cwdFor(userId, projectId)) ?? localixWorkspaceDir()
    const stdout = await runArgOptionsScript({
      scriptAbsPath: script,
      cwd,
      request: {
        query: input.query ?? '',
        cwd,
        sessionId: input.sessionId,
        argName: input.arg,
        command: input.command,
        config: resolveMiniAppConfig(entry.app.manifest?.config, scalarConfig(entry.state?.config)),
      },
    })
    return { options: parseArgOptions(stdout) }
  } catch (err) {
    deps.logger?.warn('mini app arg options failed', { err: errorMessage(err) })
    return { options: [] }
  }
}
