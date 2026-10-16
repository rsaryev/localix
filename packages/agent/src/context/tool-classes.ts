/**
 * Single source of truth for the tool-name classes the VBC context machinery
 * keys off. These sets were previously duplicated across `op-menu.ts`,
 * `prune-wire.ts`, and `targets.ts` — and had already drifted (the mutate set
 * disagreed between files). Centralizing them here keeps WHAT-is-recoverable and
 * WHAT-supersedes-what consistent, so adding a new tool only touches one place.
 *
 * The base sets contain only GENERIC tool names. An app whose tool set goes
 * beyond them registers its own names via {@link registerContextToolClasses}
 * (same process-global registration idiom as `registerProvider`/`registerModel`)
 * — app-specific tool names must never be hardcoded here.
 */

const pagedReadResultTools = new Set(['read', 'lsp', 'search', 'grep', 'ls', 'list'])
const readResultTools = new Set(pagedReadResultTools)

const mutateTools = new Set(['write', 'edit'])

// Generic patch-applier names. Localix no longer ships a patch tool, but saved sessions still
// hold historical `apply_patch` items, so they keep their class.
const patchTools = new Set(['apply_patch', 'patch'])

const allMutateTools = new Set([...mutateTools, ...patchTools])

const nonidempotentTools = new Set(['bash', 'terminal', 'shell'])

/**
 * Tools whose RESULT is a recoverable observation — re-readable from disk/source,
 * so old results can be elided near-losslessly. `bash`/`terminal` are deliberately
 * excluded: their output can't be safely reproduced.
 */
export const READ_RESULT_TOOLS: ReadonlySet<string> = readResultTools

/**
 * Core read tools whose own implementations already enforce paging/output bounds.
 * App/plugin read-result registrations intentionally do not join this set: their
 * implementations are outside the agent package's control, so the wire boundary
 * must still apply its global tool-output safety cap to them.
 */
export const PAGED_READ_RESULT_TOOLS: ReadonlySet<string> = pagedReadResultTools

/** Mutation tools that carry their heavy, recoverable payload in a single string arg. */
export const MUTATE_TOOLS: ReadonlySet<string> = mutateTools

/** Patch-style mutation tools whose payload is a unified-diff/patch body. */
export const PATCH_TOOLS: ReadonlySet<string> = patchTools

/** All mutation tools (single-arg writers + patch appliers). */
export const ALL_MUTATE_TOOLS: ReadonlySet<string> = allMutateTools

/** Side-effecting tools whose observations never supersede and are never superseded. */
export const NONIDEMPOTENT_TOOLS: ReadonlySet<string> = nonidempotentTools

export interface ContextToolClassRegistration {
  /** Tool names whose results are recoverable observations (join READ_RESULT_TOOLS). */
  readResult?: readonly string[]
  /** Single-string-arg mutation tools (join MUTATE_TOOLS and ALL_MUTATE_TOOLS). */
  mutate?: readonly string[]
  /** Patch-body mutation tools (join PATCH_TOOLS and ALL_MUTATE_TOOLS). */
  patch?: readonly string[]
  /** Side-effecting tools that never supersede / are never superseded. */
  nonidempotent?: readonly string[]
}

/**
 * Register app-specific tool names into the VBC tool classes. Additive and
 * idempotent — call once at app bootstrap, before any compression planning.
 * The exported `*_TOOLS` sets reflect registrations immediately (same objects).
 */
export function registerContextToolClasses(reg: ContextToolClassRegistration): void {
  for (const name of reg.readResult ?? []) readResultTools.add(name)
  for (const name of reg.mutate ?? []) {
    mutateTools.add(name)
    allMutateTools.add(name)
  }
  for (const name of reg.patch ?? []) {
    patchTools.add(name)
    allMutateTools.add(name)
  }
  for (const name of reg.nonidempotent ?? []) nonidempotentTools.add(name)
}
