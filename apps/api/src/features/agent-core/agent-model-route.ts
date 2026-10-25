import { resolveDeclaredReasoningEffort, type ReasoningEffort } from '../../db/types'
import { bestModelForFamily, isModelAliasFamily, type ModelAliasFamily } from './model-alias'

/**
 * THE ONE ANSWER TO "WHICH MODEL AND EFFORT DOES THIS AGENT RUN ON".
 *
 * Whatever asks (a delegated child, a workflow's `agent()`, a seat's starting route, a plugin's
 * main agent) hands over what the agent file says — `model`, `effort`, and the `localix.model`
 * route Claude Code has no place for — and what it knows of where the run happens.
 *
 * WITH A CHAT (`chat`). Claude Code picks a subagent's model as follows: the model the agent names
 * comes first, else the session's. A family alias (`haiku`, `sonnet`, `opus`, `fable`) resolves to
 * the newest model of that family the chat's provider offers, and the child runs on the chat's
 * connection; a concrete id is used when that provider offers it. A model the provider does not
 * offer is not guessed at: the agent runs on the chat's model and the run says so, as Claude Code
 * substitutes a model its allowlist blocks. With the chat already on the alias's family, its exact
 * model stays, `[1m]` suffix and all.
 *
 * WITHOUT ONE. No connection is known, so a concrete model is spelled as the catalog spells it and
 * left to find a live connection when the run starts (`providerConnectionId: null`). A bare alias
 * resolves from the catalog when there is one, keeping `inherit` when that is its own family; with
 * neither it means nothing yet and the run resolves it where it has a chat.
 *
 * EFFORT. Claude Code's `low` … `max` are Localix reasoning levels; the runtime clamps one the
 * model does not offer. An unknown word inherits, and the run says so.
 */

export interface ChatModel {
  providerId: string
  connectionId: string
  modelId: string
}

/** An agent's own route: the parts it chose, the rest inherited. */
export interface AgentRoute {
  providerConnectionId?: string | null
  modelId?: string
  reasoningEffort?: ReasoningEffort
}

/** What an agent file says about its model. */
export interface AgentModelAsk {
  /** The file's `model` (an alias, a concrete id or `inherit`). */
  model?: string
  effort?: string
  /** `localix.model`, `<provider>/<model>`: wins over `model`, because Claude Code cannot run it. */
  route?: string
}

export interface AgentModelContext {
  chat?: ChatModel
  catalog?: readonly { id: string; providerId: string }[]
  /** The model to keep when the alias names its own family and there is no chat. */
  inherit?: string
  /** Who asked, as the notes name it: a workflow's `agent()`, or an agent. */
  who?: string
}

const isInherit = (value: string | undefined) => !value || value.trim().toLowerCase() === 'inherit'

export function agentModelRoute(
  ask: AgentModelAsk,
  ctx: AgentModelContext,
): { route: AgentRoute; notes: string[] } {
  const notes: string[] = []
  const who = ctx.who ?? 'agent()'
  const route: AgentRoute = {}
  if (ask.effort) {
    const effort = resolveDeclaredReasoningEffort(ask.effort.toLowerCase())
    if (effort) route.reasoningEffort = effort
    else notes.push(`${who} effort "${ask.effort}" is not a reasoning level; the agent inherits`)
  }
  const explicit = ask.route?.trim()
  const wanted = explicit || ask.model?.trim()
  if (!wanted || isInherit(wanted)) return { route, notes }
  const { chat } = ctx
  if (!chat) {
    const modelId = explicit || concreteOrFamily(wanted, ctx)
    if (modelId) Object.assign(route, { modelId, providerConnectionId: null })
    return { route, notes }
  }
  const provider = explicit?.includes('/') ? explicit.slice(0, explicit.indexOf('/')) : undefined
  if (explicit && provider !== chat.providerId) {
    // Another provider's model: the connection is the user's credentials, found when the run starts.
    Object.assign(route, { modelId: explicit, providerConnectionId: null })
    return { route, notes }
  }
  const asked = provider ? wanted.slice(provider.length + 1) : wanted
  // A catalog id may carry its provider (`openai/gpt-4o-mini`); a route names the model as the
  // provider does, the way the chat's own route does.
  const native = (id: string) => {
    const prefix = `${chat.providerId}/`
    return id.toLowerCase().startsWith(prefix.toLowerCase()) ? id.slice(prefix.length) : id
  }
  const offered = (ctx.catalog ?? [])
    .filter((model) => model.providerId === chat.providerId)
    .map((model) => native(model.id))
  const family = isModelAliasFamily(asked) ? (asked.toLowerCase() as ModelAliasFamily) : undefined
  const modelId = family
    ? chat.modelId.toLowerCase().includes(family)
      ? chat.modelId
      : bestModelForFamily(family, offered)
    : offered.find((id) => id.toLowerCase() === native(asked).toLowerCase())
  if (modelId) Object.assign(route, { modelId, providerConnectionId: chat.connectionId })
  else
    notes.push(
      `${who} model "${wanted}" is not offered by the chat's provider; the agent runs on ${chat.modelId}`,
    )
  return { route, notes }
}

/** A concrete id as written, or an alias family resolved from the catalog's own ids. */
function concreteOrFamily(wanted: string, ctx: AgentModelContext): string | undefined {
  if (!isModelAliasFamily(wanted)) return wanted
  const family = wanted.toLowerCase() as ModelAliasFamily
  if (ctx.inherit?.toLowerCase().includes(family)) return ctx.inherit
  return bestModelForFamily(
    family,
    (ctx.catalog ?? []).map((model) => model.id),
  )
}
