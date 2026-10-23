import { isAtOrUnder, isStrictlyUnder } from '@localixai/path-containment/ancestry'

/** One derived segment in an addressable delegated-run path. */
export const AGENT_TASK_NAME_PATTERN = /^[a-z0-9][a-z0-9_]{0,47}$/

/**
 * ADDRESSABLE DELEGATED-RUN NAMES.
 *
 * WHAT IT FIXES. A session was reachable only through its opaque ref (`LOCALIX-500`), which is
 * allocated by a counter and means nothing in a run history. The runtime and UI need a readable
 * path for each one-shot child. An opaque session id cannot be
 * recognized in a transcript or execution tree, so the derived task path remains the display and
 * inspection address while the immutable session id remains the stored identity.
 *
 * THE ADDRESS IS A PATH because the distinctions below are load-bearing:
 *
 *  - A name is a PATH, not a bare label: `/root/audit_repo/probe_lint`. The tree is already the
 *    security and budget scope (`root_session_id`), so making the address mirror the topology means
 *    a name is unique for free at every depth — no registry, no second encoding of the tree.
 *  - CANONICAL vs RELATIVE. An agent at `/root/task1` can refer to its child as `task_3` or
 *    `/root/task1/task_3` interchangeably, while an agent in another branch must use the canonical
 *    name. A relative reference is resolved against the CALLER and therefore can only ever reach
 *    the caller's own subtree. That is the property that stops `send_message('worker')` from
 *    landing in a sibling branch that happens to have a `worker` too.
 *  - `root`, `.` and `..` are RESERVED segments. No upward traversal exists on purpose: an agent
 *    must not be able to walk out of its own subtree by accident, and naming a child `root` would
 *    produce a second `/root` inside one path.
 *
 * WHY A DERIVED NAME AND NOT A MODEL-CHOSEN ONE. The delegated task already carries a human title,
 * so a separate model-authored name would duplicate the same intent and could disagree with the
 * label the user sees. Deriving the name removes that
 * failure mode. The cost is that collisions are ORDINARY rather than exceptional (two siblings
 * described "audit auth flow" is a normal turn), which is exactly why the collision rule below
 * suffixes instead of rejecting.
 *
 * A NAME IS NOT A REFERENCE. It resolves TO a session id and nothing persists it: a name is scoped
 * to one tree (`/root/worker` names a different agent in every conversation), it is assigned from
 * the sibling names that happened to exist at creation time, and it is only meaningful while that tree
 * is alive — an id is globally unique and permanent. A session is already addressable three ways
 * for the STORED case (raw id, the composer's `@session:<id>` token in `contracts/context-refs.ts`, and
 * `localix://resource/chat/session/<id>` in `chat/resource-provider.ts`), and every one of them
 * keys on the id. This is the fourth address, and it is deliberately the only one that is
 * model-typed and never written down: `resolveAgentTaskReference` (here) plus
 * `findSessionIdByTaskName` (`features/chat/repository.ts`) are the ONE path from a name to an id,
 * and everything downstream of them — queue rows, provenance, wakes and execution records — carries
 * the id. Persisting a name anywhere would create a reference that silently means a different agent
 * in a different tree.
 *
 * Every function here is pure. The atomic part — claiming a name against the names a tree has
 * already handed out — lives in `features/chat/repository.ts`, where it shares one transaction with
 * the session insert.
 */

/** The first segment of every canonical path; reserving it prevents a nested second tree root. */
export const AGENT_TASK_ROOT_SEGMENT = 'root'
export const AGENT_TASK_ROOT_PATH = `/${AGENT_TASK_ROOT_SEGMENT}`

/**
 * Segment length ceiling — the upper bound `AGENT_TASK_NAME_PATTERN` encodes (1 leading character
 * plus up to 47 more). Named here because the collision suffix has to make room for itself inside
 * it, and a hard-coded 48 in two files is a rule that drifts.
 */
export const AGENT_TASK_SEGMENT_MAX = 48

/**
 * Segment used when a description slugifies to nothing usable (punctuation only, CJK only, or the
 * reserved `root`). Deliberately generic: it collides with itself and therefore flows into the
 * ordinal rule below, giving `agent`, `agent_2`, `agent_3` — readable, and never a name that points
 * somewhere unexpected.
 */
export const AGENT_TASK_SEGMENT_FALLBACK = 'agent'

/** One segment of a canonical path (NOT a whole path — segments never contain `/`). */
export function isAgentTaskSegment(segment: string): boolean {
  if (segment === AGENT_TASK_ROOT_SEGMENT) return false
  return AGENT_TASK_NAME_PATTERN.test(segment)
}

/**
 * Turn a human description into a task-name segment.
 *
 * Underscores, not dashes: `AGENT_TASK_NAME_PATTERN` allows only `[a-z0-9_]`, and the other
 * slugifiers in this repo hyphenate for filesystem/git targets — reusing one would produce a
 * name the delegated-run path grammar rejects. The
 * separator also has to survive being a MODEL-typed identifier, which is why the segment charset is
 * the one an underscore-cased symbol already uses.
 */
export function deriveAgentTaskSegment(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, AGENT_TASK_SEGMENT_MAX)
    // The cut can expose a fresh trailing `_`. Legal for the pattern, but it reads as a truncation
    // artifact and it doubles the ordinal separator (`audit__2`) when the name collides.
    .replace(/_+$/, '')
  return isAgentTaskSegment(slug) ? slug : AGENT_TASK_SEGMENT_FALLBACK
}

/** Canonical path for a child of `parentPath`. Both parts are assumed already validated. */
export function agentTaskPath(parentPath: string, segment: string): string {
  return `${parentPath}/${segment}`
}

/** A full canonical path: `/root`, or `/root` followed by one or more valid segments. */
export function isCanonicalAgentTaskPath(path: string): boolean {
  if (path === AGENT_TASK_ROOT_PATH) return true
  if (!isStrictlyUnder(AGENT_TASK_ROOT_PATH, path)) return false
  return path
    .slice(AGENT_TASK_ROOT_PATH.length + 1)
    .split('/')
    .every(isAgentTaskSegment)
}

export type AgentTaskReference = { ok: true; path: string } | { ok: false; reason: string }

/**
 * Resolve a caller-supplied reference — canonical or relative — to ONE canonical path.
 *
 * Leading `/` selects canonical; anything else is relative to the caller and may itself be
 * multi-segment (`worker/probe`), because a parent that spawned a grandchild through a child needs
 * to reach it without spelling the whole tree out.
 *
 * The reference is trimmed first: it arrives as a model-typed tool argument, and a stray space is
 * never evidence that a different agent was meant. Everything else fails CLOSED with a reason the
 * model can act on — a reference that does not resolve must never be "helpfully" matched against
 * something similar, which is the one failure mode this whole layer exists to prevent.
 */
export function resolveAgentTaskReference(
  callerPath: string,
  reference: string,
): AgentTaskReference {
  const trimmed = reference.trim()
  if (!trimmed) return { ok: false, reason: 'An agent name must not be empty.' }
  if (trimmed.startsWith('/')) {
    if (!isCanonicalAgentTaskPath(trimmed)) {
      return {
        ok: false,
        reason: `"${trimmed}" is not a canonical agent name. Canonical names start with ${AGENT_TASK_ROOT_PATH}/ and use lowercase letters, digits and underscores.`,
      }
    }
    return { ok: true, path: trimmed }
  }
  if (!isCanonicalAgentTaskPath(callerPath)) {
    return {
      ok: false,
      reason: `Caller "${callerPath}" has no canonical agent name to resolve against.`,
    }
  }
  const segments = trimmed.split('/')
  if (!segments.every(isAgentTaskSegment)) {
    return {
      ok: false,
      reason: `"${trimmed}" is not a valid agent name. Use lowercase letters, digits and underscores; "${AGENT_TASK_ROOT_SEGMENT}", "." and ".." are reserved and there is no parent reference.`,
    }
  }
  return { ok: true, path: agentTaskPath(callerPath, trimmed) }
}

/**
 * Does `path` sit at or under `prefix`?
 *
 * SEGMENT-ALIGNED, deliberately: `/root/audit` must not match `/root/audit_repo`. Underscores are
 * ordinary characters in these names, so a plain `startsWith` (or a SQL `LIKE 'prefix%'`, where `_`
 * is itself a single-character wildcard) silently widens the filter to unrelated agents. `/root`
 * matches the whole tree because every canonical agent path is at or below that segment.
 */
export function agentTaskPathHasPrefix(path: string, prefix: string): boolean {
  return isAtOrUnder(prefix, path)
}

/**
 * THE COLLISION RULE: append the first free `_<ordinal>` starting at 2.
 *
 * `audit_repo` → `audit_repo_2` → `audit_repo_3`. Never rejects, never reuses.
 *
 * WHY NOT REJECT. The name is derived from a free-text description, so a clash is a normal event,
 * not a caller mistake — failing the spawn would kill a legitimate delegation over a cosmetic
 * collision, and the model has no way to fix it (it never named the agent).
 *
 * WHY NOT REUSE / RETURN THE EXISTING ONE. That is the failure this layer exists to prevent: the
 * caller would hold a name that points at an agent it did not create, and its first
 * `send_message` would brief a stranger. A suffix makes the collision VISIBLE instead — the caller
 * is told the name it actually got.
 *
 * The search TERMINATES without needing a retry budget: distinct ordinals always yield distinct
 * candidates, so at most `taken.size` of them can be occupied and ordinal `taken.size + 2` is free
 * at the latest. A capped loop would need a fallback branch that can only ever return a name that
 * is already taken — worse than no branch at all.
 *
 * The root path is returned untouched. Two `/root` rows in ONE tree means two tree roots, which is
 * a topology bug — renaming it to `/root_2` would produce a path whose first segment is not `root`,
 * hiding the bug behind an address nothing can resolve. The unique index rejects it instead.
 */
export function claimAgentTaskPath(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired
  if (desired === AGENT_TASK_ROOT_PATH) return desired
  const cut = desired.lastIndexOf('/')
  const parentPath = desired.slice(0, cut)
  const leaf = desired.slice(cut + 1)
  for (let ordinal = 2; ; ordinal += 1) {
    const suffix = `_${ordinal}`
    // Truncate the BASE, not the result: the ordinal is what makes the name unique, so it is the
    // part that must survive the length ceiling.
    const base = leaf.slice(0, AGENT_TASK_SEGMENT_MAX - suffix.length).replace(/_+$/, '')
    const candidate = agentTaskPath(parentPath, `${base}${suffix}`)
    if (!taken.has(candidate)) return candidate
  }
}
