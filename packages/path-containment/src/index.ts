import path from 'node:path'

import { isAtOrUnder, isStrictlyUnder } from './ancestry'

/**
 * PATH CONTAINMENT — the ONE answer to "does this path stay inside that root?".
 *
 * This is a SECURITY boundary. Every subsystem that lets an outside string name a file
 * asks it: the plugin/provider discovery layer (a manifest entrypoint), the marketplace
 * installer (an entry `source`), the plugin panel reader (a manifest `file`), the ext
 * remover (never `rm -rf` a path that isn't ours), the static preview server (a URL path),
 * the context-ref expander (a `@file:` the model typed).
 *
 * ── WHY THIS IS A PACKAGE AND NOT A FILE IN `apps/api` ──────────────────────────────
 * It used to be `apps/api/src/lib/path-containment.ts`, with a source-reading lint holding
 * `apps/api` to it. That lint could not be widened, and the reason is the whole story:
 * `@localixai/api` exports no such subpath, and `packages/*` may not depend on `apps/api`
 * anyway (the dependency order is base packages ← api ← ui). So sibling packages and
 * `apps/ui` were physically unable to obey the rule — and each had
 * hand-rolled its own copy. A guard that fails a change nobody is allowed to make is a
 * guard people switch off; the fix is not a louder prohibition, it is to put the rule
 * somewhere every tree can reach. Hence a base-layer package with zero runtime deps: the
 * one thing every other tree is allowed to import.
 *
 * ── THE THREE TRAPS, OWNED ONCE ────────────────────────────────────────────────────
 *   1. `..` traversal — `resolve()` FIRST, then compare. Comparing raw strings lets
 *      `<root>/../../etc/passwd` look like it starts with `<root>`.
 *   2. The SIBLING-PREFIX attack — a bare `candidate.startsWith(root)` admits
 *      `/a/rootExtra` for root `/a/root`. The separator is not optional. (And the
 *      separator's own edge case — the filesystem root, which already ends in one — is
 *      handled in `./ancestry`, where five copies of this repo got it wrong.)
 *   3. Root-inclusive vs strictly-below — "is it the root itself?" is a real question
 *      with two real answers, and each caller must pick DELIBERATELY, not by accident of
 *      which copy it cribbed. Hence two named predicates, not one boolean flag.
 *
 * ── LEXICAL ONLY ───────────────────────────────────────────────────────────────────
 * No `realpath`, no `stat`, no symlink following. A symlink INSIDE the root that points
 * outside it still passes, BY DESIGN: these are the guards on a caller-supplied *name*,
 * not a filesystem sandbox. Callers that need symlink safety must resolve first and pass
 * the real path (`context-fabric/policy.ts` does exactly that).
 *
 * Comparison is byte-exact, so it inherits the platform's case sensitivity — which is
 * what the filesystem will do with the path anyway.
 */

declare const containedBrand: unique symbol

/**
 * AN ABSOLUTE PATH THAT HAS BEEN PROVEN TO STAY INSIDE ITS ROOT.
 *
 * This is the mechanism that turns "don't hand-roll containment" from a PROHIBITION into
 * an IMPOSSIBILITY. A `ContainedPath` is a `string` — it drops straight into `fs.readFile`,
 * `Bun.file`, `spawn`, template literals, with no unwrapping and no runtime cost. But the
 * brand is a `unique symbol` only this module can name, so the relation does not hold in
 * reverse: a plain `string` is NOT assignable to `ContainedPath`, and TypeScript has no
 * way to conjure one.
 *
 * The consequence is the point. A function that must not be handed an unchecked path stops
 * ASKING for a checked one and starts DEMANDING one:
 *
 *     function deleteDropIn(dir: ContainedPath) { … }        // callee demands proof
 *     deleteDropIn(userInput)                                 // ✗ compiler refuses
 *     deleteDropIn(resolveWithin(root, userInput) ?? fail())  // ✓ proof carried in
 *
 * The check can no longer be FORGOTTEN at the call site, and — the part a lint can never
 * do — it cannot be SATISFIED by a look-alike either: a hand-rolled `startsWith` returns a
 * `string`, and a `string` will not typecheck here. The only way to mint the proof is to
 * call the owner. Minting is therefore the cheapest path, and the copy is not forbidden so
 * much as pointless.
 *
 * The proof is LEXICAL and it is about a NAME (see the module note): it says this path
 * does not escape its root by spelling, not that the filesystem will keep it there.
 */
export type ContainedPath = string & { readonly [containedBrand]: true }

/**
 * True when `candidate` is `root` ITSELF or a path beneath it.
 *
 * Use this when naming the root is a legitimate answer — "which directory does this URI
 * belong to", "is this file inside the workspace".
 *
 * DEGENERATE INPUT — fails CLOSED. An empty `root` or an empty `candidate` returns `false`.
 * It would be easy to let them through: `path.resolve('')` is `process.cwd()`, so an unset
 * root would quietly become "contained in the current working directory" — an answer to a
 * question nobody asked, computed from ambient state, and one that says YES to paths under
 * the cwd. An absent root is a programmer error (an unread config value, a `??` that
 * defaulted to `''`), and the safe reading of "is X inside <nothing>?" is "no".
 */
export function isPathWithin(root: string, candidate: string): boolean {
  if (!root || !candidate) return false
  return isAtOrUnder(path.resolve(root), path.resolve(candidate), path.sep)
}

/**
 * True when `candidate` lies strictly BELOW `root` — the root itself is NOT contained.
 *
 * Use this when the root is a container the candidate must be a member OF: the managed
 * install root a drop-in must sit inside before it may be deleted, the plugin dir a panel
 * file must live in. Naming the container instead of a member is a miss, and a destructive
 * caller must not treat it as a hit.
 *
 * Same fail-closed contract as {@link isPathWithin}.
 */
export function isPathBelow(root: string, candidate: string): boolean {
  if (!root || !candidate) return false
  return isStrictlyUnder(path.resolve(root), path.resolve(candidate), path.sep)
}

/**
 * Resolve `target` against `root` and hand back the absolute path ONLY when it stays
 * inside (root-inclusive, per {@link isPathWithin}); `null` when it escapes.
 *
 * `target` may be relative (resolved against `root`) or absolute (taken as-is and then
 * checked) — an absolute-path shortcut out of the root is caught, not honoured.
 *
 * Returning `null` rather than throwing is what lets discovery layers treat an escaping
 * entry as "not there" and keep scanning, while a route layer maps `null` to its own typed
 * error. The rule is shared; the reaction stays the caller's.
 *
 * The success value is a {@link ContainedPath}: the proof travels with the path, so a
 * callee can demand it and the compiler will hold the caller to it.
 *
 * DEGENERATE INPUT — fails CLOSED, and this one has teeth. An empty `target` would
 * `path.resolve` to the ROOT ITSELF, so `resolveWithin(pluginDir, manifest.entry)` with a
 * missing `entry` would hand back the plugin DIRECTORY as though the manifest had named
 * it — a silent reinterpretation of "absent" as "the container". An empty `root` would
 * resolve against `process.cwd()`. Both return `null`.
 */
export function resolveWithin(root: string, target: string): ContainedPath | null {
  if (!root || !target) return null
  const abs = path.resolve(root, target)
  return isPathWithin(root, abs) ? (abs as ContainedPath) : null
}

export { isAtOrUnder, isStrictlyUnder } from './ancestry'
