/**
 * THE ANCESTRY PREDICATE — "is this path under that directory?" — and nothing else.
 *
 * ZERO IMPORTS, BY DESIGN. Not `node:path`, not a polyfill, nothing. This leaf is the
 * one place the repo is allowed to spell the ancestry rule, and it must therefore be
 * importable from EVERY tree that has ever hand-rolled it: the Node server, the agent
 * loop, a browser bundle, a plugin `.mjs`. A leaf that needs `node:path` is a leaf the
 * browser cannot import, and a rule the browser cannot import is a rule the browser will
 * re-derive — which is exactly how this repo ended up with five copies.
 *
 * It operates on paths that are ALREADY absolute and ALREADY normalized (no `..`, no
 * doubled separators). Producing such a path from a caller-supplied string is a
 * FILESYSTEM concern, and it lives one layer out in `./index` (`node:path`-backed).
 * Splitting the two is not ceremony: `path.resolve()` is platform-aware and cannot run
 * in a browser, while the trap below is platform-independent and must run everywhere.
 *
 * ── THE TRAP ────────────────────────────────────────────────────────────────────────
 * Everyone writes `candidate.startsWith(root)`. It is wrong: for root `/a/log` it admits
 * `/a/logger`. So everyone's SECOND attempt is `candidate.startsWith(root + sep)`, which
 * fixes the sibling but breaks on the one root whose name already ends in the separator —
 * the FILESYSTEM ROOT itself. Under root `/`, `'/foo'.startsWith('//')` is false, so `/`
 * is found to contain NOTHING. Every hand-rolled copy in this repo had that hole, and
 * one historical copy reached a parallel-operation serializer, where "the root contains
 * nothing" incorrectly meant "these writes do not overlap".
 *
 * That is the whole reason this file exists: the fix is one line, and it was missing from
 * one line in five different files.
 */

/**
 * `true` when `candidate` IS `root` or lies beneath it.
 *
 * Both arguments must already be absolute and normalized (see the module note). `sep` is
 * the separator those paths are written with — `'/'` for the POSIX/server/URL paths the
 * browser and the agent loop pass around, `path.sep` for a `node:path`-resolved one.
 *
 * DEGENERATE INPUT — every one of these FAILS CLOSED (`false`), because the only honest
 * answer to "is X inside <nothing>?" is "no", and a containment check that answers "yes"
 * to a root it was never given is a fail-open:
 *
 *   root `''`        → false. An unset root is a programmer error, not a universal set.
 *   candidate `''`   → false. There is no path there to contain.
 *   sep  `''`        → false. Without a separator there is no boundary to respect, and
 *                      the check would silently degrade to bare `startsWith` — the bug.
 *
 * The one root that legitimately ends in `sep` is the filesystem root (`/`, or a Windows
 * drive root `C:\`). It is handled, not special-cased away: the separator is appended
 * only when it is not already there.
 */
export function isAtOrUnder(root: string, candidate: string, sep = '/'): boolean {
  if (!root || !candidate || !sep) return false
  if (candidate === root) return true
  // A root that already ends in the separator IS the filesystem root. Appending a second
  // one would ask `'/foo'.startsWith('//')` and conclude that `/` contains nothing.
  const prefix = root.endsWith(sep) ? root : root + sep
  return candidate.startsWith(prefix)
}

/**
 * `true` when `candidate` lies STRICTLY beneath `root` — the root itself is NOT contained.
 *
 * The distinction is not pedantry, it is the difference between a hit and a miss for a
 * DESTRUCTIVE caller: "the drop-in must sit inside the managed install root before we may
 * delete it" must not accept the install root itself. Two named predicates rather than one
 * boolean flag, so the call site states which question it is asking and a reader can check
 * the answer without chasing an argument.
 *
 * Same degenerate contract as {@link isAtOrUnder}: absent input fails closed.
 */
export function isStrictlyUnder(root: string, candidate: string, sep = '/'): boolean {
  return candidate !== root && isAtOrUnder(root, candidate, sep)
}
