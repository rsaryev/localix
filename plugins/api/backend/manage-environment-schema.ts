/**
 * The MODEL-FACING CONTRACT of `manage_environment`.
 *
 * A SECOND tool rather than six more actions on `http_request` — the precedent is trading, which
 * splits `market_data` from `manage_chart`. The split is by subject, not by size: `http_request`
 * answers "what call do I make", this answers "against which deployment". A model reaching for one
 * is not reaching for the other, and a fourteen-action enum is a tool whose description nobody
 * reads to the end.
 */

import type { z as Zod } from 'zod'
import { environmentVariablesProblem } from './environment-vault'

export const ENVIRONMENT_ACTIONS = ['list', 'save', 'use', 'get', 'delete'] as const

export interface PairInput {
  name: string
  value: string
  disabled?: boolean
  secret?: boolean
}

export interface ManageEnvironmentInput {
  action: (typeof ENVIRONMENT_ACTIONS)[number]
  name?: string
  variables?: PairInput[]
}

export function buildManageEnvironmentSchema(z: typeof Zod) {
  return z.object({
    action: z
      .enum(ENVIRONMENT_ACTIONS)
      .describe(
        '`list` shows every environment and which is active; `save` creates or updates one; ' +
          '`use` makes one active (its variables are what requests render against); ' +
          '`get` shows one environment’s variables; `delete` removes one.',
      ),
    name: z
      .string()
      .optional()
      .describe('For save/use/get/delete: the environment name, e.g. `staging`.'),
    variables: z
      .object({
        name: z
          .string()
          .describe('Variable name, referenced as `{{ base_url }}`, e.g. `base_url`.'),
        value: z.string().describe('Its value, e.g. `https://staging.api.dev`.'),
        disabled: z
          .boolean()
          .optional()
          .describe('Set true to keep the variable but not apply it.'),
        secret: z
          .boolean()
          .optional()
          .describe(
            'Set true for a credential. A literal is moved into the native vault; a `${secret:KEY}` reference reuses an existing vault item.',
          ),
      })
      .array()
      .optional()
      .describe(
        'For save: the full variable list — it REPLACES the environment’s existing variables. ' +
          'e.g. [{"name":"base_url","value":"https://staging.api.dev"}].',
      ),
  })
}

/**
 * Guards the flat schema cannot express, as fix-it messages. Pure and zod-free.
 */
export function manageEnvironmentProblem(input: ManageEnvironmentInput): string | null {
  const { action } = input
  if (action !== 'list' && !input.name?.trim()) {
    return `action="${action}" needs a "name", e.g. {"action":"${action}","name":"staging"}.`
  }
  if (action === 'save' && (!input.variables || input.variables.length === 0)) {
    return 'action="save" needs "variables", e.g. {"action":"save","name":"staging","variables":[{"name":"base_url","value":"https://staging.api.dev"}]}. To remove an environment use action="delete".'
  }
  const variablesProblem = environmentVariablesProblem(input.variables ?? [])
  if (variablesProblem) return variablesProblem
  return null
}
