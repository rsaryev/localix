/**
 * The `manage_environment` tool body. Wiring only — the rules live in the schema module and the
 * "exactly one active" invariant lives in the service.
 */

import type { AgentTool } from '@localixai/agent/agents'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import path from 'node:path'
import { classifyEnvironmentCall } from './call-class'
import { collectionRootFor } from './collection/for-scope'
import { ENVIRONMENTS_DIR, normalizeEnvironmentName } from './collection/environments'
import type { EnvironmentService } from './environments/service'
import type { SavedEnvironment } from './environments/store'
import {
  buildManageEnvironmentSchema,
  manageEnvironmentProblem,
  type ManageEnvironmentInput,
} from './manage-environment-schema'
import { activePairs } from './request-spec'

export interface ManageEnvironmentDeps {
  ctx: MiniAppContext
  environments: EnvironmentService
  userId: string
}

function describe(env: SavedEnvironment): string {
  const vars = activePairs(env.variables)
  const marker = env.active ? '* ' : '  '
  const names = vars.map((v) => v.name).join(', ')
  return `${marker}${env.id}: ${vars.length} variable${vars.length === 1 ? '' : 's'}${names ? ` (${names})` : ''}`
}

export function createManageEnvironmentTool(deps: ManageEnvironmentDeps): AgentTool {
  const { ctx, environments, userId } = deps

  return ctx.defineTool({
    name: 'manage_environment',
    label: 'REST environment',
    activeVerb: 'Configuring',
    executionMode: 'sequential',
    description:
      'Manage the variables saved requests render against, so one request can point at dev, ' +
      'staging or production without being rewritten. A request written as ' +
      '`{{base_url}}/users` resolves against the ACTIVE environment when it is sent. ' +
      'e.g. {"action":"save","name":"staging","variables":[{"name":"base_url","value":"https://staging.api.dev"}]} ' +
      'then {"action":"use","name":"staging"}. ' +
      'Plain variables hold values like a host or account id. Mark a credential with `secret:true`; ' +
      'its literal is moved into the native vault before the environment file is written and is ' +
      'resolved only for the outgoing request.',
    inputSchema: buildManageEnvironmentSchema(ctx.z),
    // `save`/`use`/`delete` all persist: the environment store, and the active-environment
    // pointer that every `{{variable}}` in a request resolves through.
    mutates: true,
    /**
     * This body also serves unscoped use, where the active pointer lives in `ctx.stateDir`.
     * The unified `api_client` replaces these exact paths with the common session-collection root
     * during planning, then constructs a session-scoped body for execution.
     */
    permissionPaths: (input) => {
      const call = (input ?? {}) as { action?: unknown; name?: unknown }
      if (call.action === 'list' || call.action === 'get') return []

      const activePointer = path.join(ctx.stateDir, 'active-environment.json')
      if (call.action === 'use') return [activePointer]
      if (call.action !== 'save' && call.action !== 'delete') return []
      if (typeof call.name !== 'string') return []

      const name = normalizeEnvironmentName(call.name)
      if (name === null) return []
      const environmentRoot = path.join(collectionRootFor(ctx.cwd), ENVIRONMENTS_DIR)
      const environmentFile = path.join(environmentRoot, `${name}.json`)
      return call.action === 'save'
        ? [environmentFile, environmentRoot, activePointer]
        : [environmentFile, activePointer]
    },
    classify: classifyEnvironmentCall,

    async execute(_toolCallId, input: ManageEnvironmentInput) {
      const problem = manageEnvironmentProblem(input)
      if (problem) return ctx.helpers.errorResult(problem)

      try {
        switch (input.action) {
          case 'list': {
            const all = await environments.list(userId)
            if (all.length === 0) {
              return {
                content:
                  'No environments yet. Create one with {"action":"save","name":"dev","variables":[{"name":"base_url","value":"https://api.dev"}]}.',
              }
            }
            const active = all.some((e) => e.active)
            return {
              content:
                all.map(describe).join('\n') +
                (active
                  ? '\n\n(* = active)'
                  : '\n\nNONE is active — requests using {{variables}} will not resolve. Activate one with {"action":"use","name":"…"}.'),
            }
          }

          case 'get': {
            const env = await environments.get(userId, input.name!.trim())
            if (!env) return ctx.helpers.errorResult(`No environment named "${input.name}".`)
            const vars = activePairs(env.variables)
              .map((v) => `  ${v.name} = ${v.value}`)
              .join('\n')
            return {
              content: `${env.id}${env.active ? ' (active)' : ''}\n${vars || '  (no variables)'}`,
            }
          }

          case 'save': {
            const name = input.name!.trim()
            const existed = (await environments.get(userId, name)) !== null
            const env = await environments.save(
              userId,
              name,
              input.variables!.map(({ name: n, value, disabled, secret }) => ({
                name: n,
                value,
                disabled,
                secret,
              })),
            )
            return {
              content:
                `${existed ? 'Updated' : 'Saved'} environment "${name}" with ${env.variables.length} variable(s).` +
                (env.active
                  ? ' It is active, so requests render against it now.'
                  : ` Activate it with {"action":"use","name":"${name}"}.`),
            }
          }

          case 'use': {
            const env = await environments.use(userId, input.name!.trim())
            if (!env) return ctx.helpers.errorResult(`No environment named "${input.name}".`)
            return { content: `"${env.id}" is now the active environment.` }
          }

          case 'delete': {
            const name = input.name!.trim()
            const wasActive = (await environments.get(userId, name))?.active === true
            if (!(await environments.remove(userId, name))) {
              return ctx.helpers.errorResult(`No environment named "${name}".`)
            }
            return {
              content:
                `Deleted environment "${name}".` +
                // Say so rather than promoting a replacement: which one would be a guess, and
                // sending against a guessed environment is what environments exist to prevent.
                (wasActive ? ' It was the active one, so NO environment is active now.' : ''),
            }
          }
        }
      } catch (err) {
        return ctx.helpers.errorResult(err instanceof Error ? err.message : String(err))
      }
    },
  })
}
