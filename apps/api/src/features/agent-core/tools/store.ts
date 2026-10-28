import { defineAgentTool, type AgentToolResult } from '@localixai/agent/agents'
import type { ListingRef, Scope } from '@localixai/store'
import { errorMessage } from '../../../lib/errors'
import { TOOL } from '../tool-names'
import { askStoreApproval, canConfirm, NO_APPROVER } from './store-approval'
import {
  classifyStoreCall,
  isStoreMutation,
  planText,
  refText,
  storeCard,
  storeDetail,
  storePermissionResources,
  storeToolInputSchema,
  type StoreInput,
  type StoreToolPort,
} from './store-call'

export { classifyStoreCall, type StoreToolPort } from './store-call'

/** Results a search shows: a model chooses among a few, and asks again with other words. */
const SEARCH_LIMIT = 10
/** Results each search of a batch shows, so eight of them stay one short answer. */
const BATCH_LIMIT = 5

const fail = (content: string): AgentToolResult => ({ content, isError: true })

/** What a change asks the person, in the words of its card. */
function questionOf(input: StoreInput, ref: ListingRef | undefined, scope: Scope) {
  const where = scope === 'project' ? 'this project' : 'you'
  if (input.action === 'create') {
    return {
      title: `Create ${input.kind} ${input.values?.name ?? ''} for ${where}`.replace(/ +/g, ' '),
      lines: Object.entries(input.values ?? {}).map(([key, value]) => `${key}: ${value}`),
    }
  }
  if (input.action === 'remove') {
    return { title: `Remove ${refText(ref!)} for ${where}`, lines: ['It cannot be undone.'] }
  }
  return {
    title: `${input.action[0]!.toUpperCase()}${input.action.slice(1)} ${refText(ref!)} for ${where}`,
    lines: [] as string[],
  }
}

/**
 * `store` — the agent's window onto the Store, over the same service the Store screen uses:
 * search and read what the person's added sources list, install, update, switch and remove it, and
 * make an agent or a skill. Everything that changes anything waits on a card the person answers
 * (`store-approval.ts`); an install's plan is on that card, and the Store receives the plan's
 * consent only once it is approved. A job (install, update) is queued: re-read with `get`.
 */
export function createStoreTool(port: StoreToolPort) {
  return defineAgentTool<StoreInput>({
    name: TOOL.Store,
    label: 'Store',
    activeVerb: 'Using the Store',
    description:
      'Find, inspect and manage packages from the sources the user added: mini apps, plugins, MCP servers, skills and agents. ' +
      'search (query, kind, installed) returns cards; queries runs several searches in one call, grouped per query: prefer it to repeated calls. get shows one with what it installs and runs; install, update, remove, enable and disable take a ref and a scope (user or project) and each waits for the user’s approval. ' +
      'Install and update only start the job: check the result with get. create makes an agent (name, description, instructions) or a skill (name, description, content). ' +
      'Prefer an existing package to a new one, and never install what the task does not need.',
    inputSchema: storeToolInputSchema,
    mutates: true,
    classify: classifyStoreCall,
    permissionResources: storePermissionResources,
    executionMode: 'sequential',
    executionModeFor: (input) =>
      classifyStoreCall(input).effect === 'read' ? 'parallel' : 'sequential',
    async execute(toolCallId, raw, signal, onUpdate, context) {
      const input = storeToolInputSchema.parse(raw)
      const { ref } = input
      try {
        if (input.action === 'search' && input.queries) return await batch(input, input.queries)
        if (input.action === 'search') {
          const found = await port.search({
            ...(input.query ? { query: input.query } : {}),
            ...(input.kind ? { kind: input.kind } : {}),
            ...(input.installed !== undefined ? { installed: input.installed } : {}),
            limit: SEARCH_LIMIT,
          })
          return {
            content: JSON.stringify({
              results: found.map(storeCard),
              ...(found.length >= SEARCH_LIMIT
                ? { note: `First ${SEARCH_LIMIT} shown; narrow the query for others.` }
                : {}),
            }),
          }
        }
        if (input.action === 'get') {
          if (!ref) return fail('get requires "ref": {kind, id} from a search card.')
          const detail = await port.detail(ref)
          // A kind made here rather than installed has no plan; that is not an error.
          const plan = await port.plan(ref, input.scope ?? 'user').catch(() => null)
          return { content: JSON.stringify(storeDetail(detail, plan)) }
        }
        return await change(input, toolCallId, signal, onUpdate, context)
      } catch (error) {
        return fail(errorMessage(error))
      }
    },
  })

  /**
   * Several searches at once, concurrently through the same port a single one uses, each kept
   * short. A package an earlier query showed is named, not repeated; a query that fails says so in
   * its own group and the others still answer.
   */
  async function batch(input: StoreInput, queries: readonly string[]): Promise<AgentToolResult> {
    const answers = await Promise.allSettled(
      queries.map((query) =>
        port.search({
          query,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.installed !== undefined ? { installed: input.installed } : {}),
          limit: BATCH_LIMIT,
        }),
      ),
    )
    const shown = new Map<string, string>()
    const groups = answers.map((answer, at) => {
      const query = queries[at]!
      if (answer.status === 'rejected') return { query, error: errorMessage(answer.reason) }
      const results = answer.value.map((listing) => {
        const key = `${listing.ref.kind}:${listing.ref.id}`
        const first = shown.get(key)
        if (first !== undefined) return { ref: listing.ref, shownFor: first }
        shown.set(key, query)
        return storeCard(listing)
      })
      return {
        query,
        results,
        ...(results.length >= BATCH_LIMIT
          ? { note: `First ${BATCH_LIMIT} shown; search it alone for more.` }
          : {}),
      }
    })
    return { content: JSON.stringify({ groups }) }
  }

  async function change(
    input: StoreInput,
    toolCallId: string,
    signal: AbortSignal | undefined,
    onUpdate: Parameters<typeof askStoreApproval>[0]['onUpdate'],
    context: Parameters<typeof canConfirm>[0],
  ): Promise<AgentToolResult> {
    if (!isStoreMutation(input.action)) return fail(`Unknown action "${input.action}".`)
    const { ref, scope } = input
    if (!scope) return fail(`${input.action} requires "scope": user or project.`)
    if (input.action === 'create') {
      if (input.kind !== 'agent' && input.kind !== 'skill')
        return fail('create requires "kind": agent or skill.')
      if (!input.values?.name) return fail('create requires "values" with at least a name.')
    } else if (!ref) {
      return fail(`${input.action} requires "ref": {kind, id} from a search card.`)
    }
    // Before the person is asked, so a refusal never costs a card; and nothing below runs
    // unless a person can answer it.
    if (!canConfirm(context)) return fail(NO_APPROVER)

    const question = questionOf(input, ref, scope)
    const lines = [...question.lines]
    if (input.action === 'install') {
      const plan = await port.plan(ref!, scope)
      lines.push(...planText(plan))
      if (plan.needsConsent) lines.push('It asks for your consent before it installs.')
    }
    const approval = await askStoreApproval({
      context: context!,
      toolCallId,
      title: question.title,
      lines,
      signal,
      onUpdate,
    })
    if (!approval.approved) return approval.result

    if (input.action === 'install') {
      // The card above listed the plan: a yes to it is the plan's consent.
      await port.install(ref!, scope, { plan: true })
      return {
        content: `Install of ${refText(ref!)} (${scope}) started. It runs in the background: check it with get.`,
      }
    }
    if (input.action === 'update') {
      await port.update(ref!, scope)
      return {
        content: `Update of ${refText(ref!)} (${scope}) started. It runs in the background: check it with get.`,
      }
    }
    if (input.action === 'remove') {
      await port.remove(ref!, scope)
      return { content: `Removed ${refText(ref!)} (${scope}).` }
    }
    if (input.action === 'enable' || input.action === 'disable') {
      await port.setEnabled(ref!, scope, input.action === 'enable')
      return {
        content: `${input.action === 'enable' ? 'Enabled' : 'Disabled'} ${refText(ref!)} (${scope}).`,
      }
    }
    const made = await port.create(input.kind!, scope, input.values!)
    return { content: `Created ${refText(made)} (${scope}).` }
  }
}
