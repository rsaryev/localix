/**
 * Targeting + SELF-HEAL: resolve a `VfCommand` to a live element.
 *
 * A ref (`eN`) points into the snapshot the agent last saw, so the page may have moved on
 * beneath it. When the ref is stale we re-snapshot and retry once, and either way hand the
 * caller a FRESH snapshot — a failure the agent can act on beats a failure it must guess at.
 */
import type { VfCommand, VfCommandErrorCode, VfSnapshot } from '../protocol/index'
import { buildSnapshot, type RefRegistry } from '../snapshot/index'
import type { ActuateDeps, ActuateResult } from './types'
import { getElementSummary } from '../core/identify'
import { stateForDiff } from './diff'

/* ------------------------------- targeting -------------------------------- */

export interface Fail {
  ok: false
  error: string
  errorCode: VfCommandErrorCode
}
export const fail = (errorCode: VfCommandErrorCode, error: string): Fail => ({
  ok: false,
  error,
  errorCode,
})

export function resolveTarget(cmd: VfCommand, reg: RefRegistry, root?: Element): Element | Fail {
  if (cmd.ref) {
    const el = reg.get(cmd.ref)
    // Under a root, a ref healed by its selector could land outside it; that is not the target.
    if (el && (!root || root.contains(el))) return el
    return fail(
      'not_found',
      `ref "${cmd.ref}" not found — the page changed; take a fresh snapshot.`,
    )
  }
  if (cmd.selector) {
    let el: Element | null = null
    try {
      el = (root ?? document).querySelector(cmd.selector)
    } catch {
      return fail('bad_request', `invalid selector "${cmd.selector}"`)
    }
    if (el) return el
    return fail('not_found', `selector "${cmd.selector}" matched nothing.`)
  }
  return fail('bad_request', 'a ref or selector is required for this action.')
}

export function isFail(v: unknown): v is Fail {
  // `'ok' in v` narrows honestly. The old shape reached the field through `(v as Fail).ok`,
  // which told the typechecker the value was already `false` — a lie about an `unknown`.
  // It made `ok === false` look redundant, and "simplifying" it to `!v.ok` reclassifies
  // every foreign object (whose `ok` is `undefined`) as a failure.
  return typeof v === 'object' && v !== null && 'ok' in v && v.ok === false
}

/* --------------------------- self-healing resolve -------------------------- */

/** A resolved target, plus (when we recovered a stale ref) the fresh snapshot that
 *  the retry ran against and a note describing the re-resolution. */
export interface Healed {
  ok: true
  el: Element
  snapshot?: VfSnapshot
  healNote?: string
}
/** A resolution that could not recover — carries a fresh snapshot so the agent gets
 *  current refs WITHOUT spending a separate `snapshot` round-trip. */
export interface HealFail {
  ok: false
  error: string
  errorCode: VfCommandErrorCode
  snapshot?: VfSnapshot
}

export function isHealFail(v: Healed | HealFail): v is HealFail {
  return !v.ok
}

/**
 * Resolve a targeting command with SELF-HEALING. On a plain hit, return the element.
 * On a `not_found` (the #1 preview-churn failure — a ref went stale after a page
 * change), re-snapshot ONCE in-probe and try to re-resolve the intended element by
 * the structural identity captured at snapshot time (selector, then a unique
 * role+name match). If that lands, retry the action against the fresh element and
 * hand back the fresh snapshot; if it's ambiguous/gone, return the error WITH the
 * fresh snapshot — either way the agent never has to spend a call just to re-snapshot.
 */
export function resolveWithHeal(cmd: VfCommand, deps: ActuateDeps): Healed | HealFail {
  const direct = resolveTarget(cmd, deps.reg, deps.root)
  if (!isFail(direct)) return { ok: true, el: direct }
  // Only "not found" is recoverable (a stale ref / vanished selector). A bad selector
  // or a "no target given" is a caller error — pass it straight through, no snapshot.
  if (direct.errorCode !== 'not_found')
    return { ok: false, error: direct.error, errorCode: direct.errorCode }

  // Capture the stale ref's identity BEFORE the fresh snapshot clears the registry,
  // then re-snapshot so the agent gets current refs regardless of the outcome.
  const identity = cmd.ref ? deps.reg.identityOf(cmd.ref) : null
  const snapshot = buildSnapshot(deps.reg, { root: deps.root })
  deps.prevTree.value = stateForDiff(deps.root)

  const found = identity ? deps.reg.findByIdentity(identity) : null
  const healed = found && (!deps.root || deps.root.contains(found)) ? found : null
  if (healed) {
    return {
      ok: true,
      el: healed,
      snapshot,
      healNote: `(ref "${cmd.ref}" had gone stale — re-resolved to ${getElementSummary(healed)} by structural identity and retried)`,
    }
  }
  const what = cmd.ref ? `ref "${cmd.ref}"` : `selector "${cmd.selector}"`
  return {
    ok: false,
    errorCode: 'not_found',
    error: `${what} not found — the page changed. A fresh snapshot is attached below; retarget using its [ref=eN] handles.`,
    snapshot,
  }
}

/** Turn a HealFail into an ActuateResult, folding the fresh snapshot into `result`
 *  so it reaches the agent in the SAME round-trip. */
export function healFailResult(action: VfCommand['action'], t: HealFail): ActuateResult {
  return {
    ok: false,
    error: t.error,
    errorCode: t.errorCode,
    ...(t.snapshot ? { result: { action, snapshot: t.snapshot } } : {}),
  }
}

/** Find a plausible close/dismiss control inside (the dialog around) a covering
 *  element, so a "covered" error can point the agent straight at the escape hatch. */
export function findCloseControl(blocker: Element): Element | null {
  const scope = blocker.closest('[role="dialog"],[aria-modal="true"]') ?? blocker
  const sel =
    'button[aria-label*="close" i],[aria-label*="dismiss" i],button[title*="close" i],[data-dismiss],.close,.modal-close'
  try {
    const el = scope.querySelector(sel)
    if (el) return el
  } catch {
    /* bad selector impossible here, but stay defensive */
  }
  // Fallback: a button whose visible text is just an ×/close glyph.
  for (const b of Array.from(scope.querySelectorAll('button,[role="button"]'))) {
    if (/^(×|✕|✖|╳|x|close)$/i.test((b.textContent ?? '').trim())) return b
  }
  return null
}
