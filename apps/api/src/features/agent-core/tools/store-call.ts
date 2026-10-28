import { z } from 'zod'
import type { CallClass } from '@localixai/agent/agents'
import {
  packageKindSchema,
  scopeSchema,
  type InstallPlan,
  type Listing,
  type ListingDetail,
  type ListingRef,
  type PackageKind,
  type Scope,
} from '@localixai/store'

/**
 * The `Store` tool's call contract: its input, the port a host gives it (A4: agent-core declares
 * it, `chat/runtime/run/store-options.ts` implements it over the Store service), what each call
 * means to the permission path, and how a listing reads to the model. The tool is `store.ts`.
 *
 * It acts only on sources the person already added: there is no action to add, remove or refresh a
 * source, so what the agent can install is bounded by what the person chose to trust.
 */

const STORE_ACTIONS = [
  'search',
  'get',
  'install',
  'update',
  'remove',
  'enable',
  'disable',
  'create',
] as const

/** Searches one call may carry. */
export const STORE_BATCH_MAX = 8

const MUTATING = new Set<string>(['install', 'update', 'remove', 'enable', 'disable', 'create'])
export const isStoreMutation = (action: unknown): boolean =>
  typeof action === 'string' && MUTATING.has(action)

/** A flat object, not a union by action: providers flatten `oneOf` badly. */
export const storeToolInputSchema = z.strictObject({
  action: z.enum(STORE_ACTIONS),
  query: z.string().optional().describe('search: words; omit to browse.'),
  queries: z
    .array(z.string().min(1))
    .min(1)
    .max(STORE_BATCH_MAX)
    .optional()
    .describe('search: several at once, one group each; use instead of repeated calls.'),
  kind: packageKindSchema.optional().describe('search: one kind. create: agent or skill.'),
  installed: z.boolean().optional().describe('search: only what is (true) or is not installed.'),
  ref: z
    .strictObject({ kind: packageKindSchema, id: z.string().min(1) })
    .optional()
    .describe('A card’s ref, as search returned it.'),
  scope: scopeSchema.optional().describe('Required to change anything: user or project.'),
  values: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'create: agent {name, description, instructions}; skill {name, description, content}.',
    ),
})
export type StoreInput = z.infer<typeof storeToolInputSchema>

/** What the host reaches the Store through, already bound to the person and the open project. */
export interface StoreToolPort {
  search(query: {
    query?: string
    kind?: PackageKind
    installed?: boolean
    limit: number
  }): Promise<Listing[]>
  detail(ref: ListingRef): Promise<ListingDetail>
  /** Throws for a kind that is made here rather than installed. */
  plan(ref: ListingRef, scope: Scope): Promise<InstallPlan>
  install(ref: ListingRef, scope: Scope, consent: { plan: boolean }): Promise<void>
  update(ref: ListingRef, scope: Scope): Promise<void>
  remove(ref: ListingRef, scope: Scope): Promise<void>
  setEnabled(ref: ListingRef, scope: Scope, enabled: boolean): Promise<void>
  create(kind: PackageKind, scope: Scope, values: Record<string, string>): Promise<ListingRef>
}

/**
 * Reads observe; every change reaches the person's durable state (`host`) and is answered by a card
 * the tool raises itself, so an unattended run refuses it (`needsHuman`). A removal cannot be
 * redone. An unknown action gets the widest answer: on the permission path a guess opens nothing.
 */
export function classifyStoreCall(input: unknown): CallClass {
  const action = input && typeof input === 'object' ? (input as { action?: unknown }).action : null
  if (action === 'search' || action === 'get') return { effect: 'read' }
  if (action === 'remove') return { effect: 'host', needsHuman: true, irreversible: true }
  if (isStoreMutation(action)) return { effect: 'host', needsHuman: true }
  return { effect: 'external' }
}

/**
 * The resources a call touches, as a rule's pattern names them: `install:plugin:review@market:user`.
 * A malformed call declares only its action; the schema refuses it before anything runs.
 */
export function storePermissionResources(input: unknown): string[] {
  const parsed = storeToolInputSchema.safeParse(input)
  if (!parsed.success) {
    const action = (input as { action?: unknown } | null)?.action
    return typeof action === 'string' && action ? [action] : ['store']
  }
  const { action, ref, kind, scope, values } = parsed.data
  if (!isStoreMutation(action)) return [action]
  const target = action === 'create' ? `${kind ?? '?'}:${values?.name ?? '?'}` : subject(ref)
  return [`${action}:${target}:${scope ?? '?'}`]
}

const subject = (ref: ListingRef | undefined) => (ref ? `${ref.kind}:${ref.id}` : '?')

/** A ref as a sentence's object: `plugin review@market`. */
export const refText = (ref: ListingRef) => `${ref.kind} ${ref.id}`

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/** One listing as the model reads it in a search: what to choose by, and what is installed. */
export function storeCard(listing: Listing) {
  return {
    ref: listing.ref,
    name: listing.displayName,
    kind: listing.ref.kind,
    summary: clip(listing.summary, 140),
    publisher: listing.publisher.verified
      ? `${listing.publisher.name} (verified)`
      : listing.publisher.name,
    ...(listing.source.trust ? { trust: listing.source.trust } : {}),
    installs: listing.installs.map(({ scope, version, enabled }) => ({
      scope,
      ...(version ? { version } : {}),
      enabled,
    })),
    ...updateOf(listing),
    ...(listing.job ? { job: `${listing.job.action} ${listing.job.phase}` } : {}),
    ...(listing.incompatible ? { incompatible: listing.incompatible } : {}),
  }
}

const updateOf = (listing: Listing) => {
  const updateTo = listing.installs.find((install) => install.updateTo)?.updateTo
  return updateTo ? { updateTo } : {}
}

/** The plan as the model reads it, and as the person's card lists it. */
export const planText = (plan: InstallPlan): string[] => [
  ...(plan.adds.length ? [`Adds: ${plan.adds.map((c) => `${c.kind} ${c.name}`).join(', ')}`] : []),
  ...plan.runs.map(
    (run) => `Runs: ${run.kind} ${run.name}${run.command ? ` — ${run.command}` : ''}`,
  ),
  ...(plan.network.length ? [`Network: ${plan.network.join(', ')}`] : []),
  ...(plan.requires.length ? [`Installs with it: ${plan.requires.map(refText).join(', ')}`] : []),
  ...plan.warnings.map((warning) => `Warning: ${warning}`),
]

/** A package's page for the model: the card, a longer summary, what is inside, and the plan. */
export function storeDetail(detail: ListingDetail, plan: InstallPlan | null) {
  return {
    ...storeCard(detail),
    summary: clip(detail.summary, 600),
    ...(detail.version ? { version: detail.version } : {}),
    source: detail.source.label,
    components: detail.components.slice(0, 20).map(({ kind, name }) => `${kind} ${name}`),
    plan: plan && {
      scope: plan.scope,
      adds: plan.adds.map(({ kind, name }) => ({ kind, name })),
      runs: plan.runs,
      network: plan.network,
      requires: plan.requires,
      warnings: plan.warnings,
      needsConsent: plan.needsConsent,
    },
  }
}
