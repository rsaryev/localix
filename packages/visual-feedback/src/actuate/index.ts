/**
 * Actuation — execute one agent `VfCommand` against the live page: read it
 * (snapshot/console), or synthesize a real interaction (click/type/press/scroll/
 * hover). Targeting is by `eN` ref (from the latest snapshot) or CSS selector.
 *
 * Reliability touches:
 *  - occlusion pre-check before a click → an actionable `intercepted` error naming
 *    the covering element (consent banner / modal), instead of a silent mis-click;
 *  - synthesized pointer+mouse events at the element center (not `el.click()`), so
 *    custom controls that listen on pointer/mouse fire correctly;
 *  - React-friendly value setting (native setter) so `input` events register.
 */

import type { VfCommand, VfSnapshot } from '../protocol/index'
import { getElementSummary, getSemanticRole } from '../core/identify'
import { getViewportRect, scrollContainerIn } from '../core/geometry'
import { motionSafeScrollBehavior } from '../core/motion'
import { buildSnapshot } from '../snapshot/index'
import { rasterizeElement } from '../rasterize/index'
import {
  centerPoint,
  occludedBy,
  dispatchMouse,
  dispatchPointer,
  synthClick,
  fillValue,
  pressKey,
  hitTarget,
} from './input'
import { stateForDiff } from './diff'
import { stepNote, failedStep } from './batch-report'
import { postAction } from './post-action'
import { serializeEvalResult, compileEvalExpression } from './evaluate'

// The console ring buffer + interaction synthesis + interactive-tree diffing live
// in sibling leaves; re-export the public console helper so importers of
// actuate/index keep their surface (the probe entry + the tests).
export { installConsoleCapture, type ConsoleCapture } from './console-capture'

// Targeting/self-heal, the settle strategy, and the dispatcher contract live in sibling
// leaves. Re-exported so importers of actuate/index (the probe entry + the tests) keep
// exactly the surface they had.
export type { ActuateDeps, ActuateResult } from './types'
export { settleTransitions } from './settle'
import type { ActuateDeps, ActuateResult } from './types'
import { settleTransitions } from './settle'
import {
  fail,
  isFail,
  isHealFail,
  resolveTarget,
  resolveWithHeal,
  healFailResult,
  findCloseControl,
  type Healed,
} from './target'

/** Execute one command. DOM side effects; returns a serializable result. Async
 *  because `screenshot` rasterizes the element in-page. */
export async function runCommand(cmd: VfCommand, deps: ActuateDeps): Promise<ActuateResult> {
  try {
    return await dispatch(cmd, deps)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      errorCode: 'failed',
    }
  }
}

/** Append the self-heal note (when a stale ref was recovered) to an action note. */
function withHeal(note: string, t?: Healed): string {
  return t?.healNote ? `${note} ${t.healNote}` : note
}

/** Force a fresh post-action snapshot whenever we self-healed (the recovery's whole
 *  point is to leave the agent with usable refs); otherwise honor the command flag. */
function snapAfter(cmd: VfCommand, t?: Healed): boolean {
  return Boolean(cmd.snapshotAfter) || Boolean(t?.healNote)
}

async function dispatch(cmd: VfCommand, deps: ActuateDeps): Promise<ActuateResult> {
  // Capture the console cursor BEFORE any DOM effect so a drive action's postAction can
  // attach exactly the error/warn entries (incl. auto-dismissed dialogs) IT triggered.
  const consoleCursor = deps.console.cursor()
  switch (cmd.action) {
    case 'snapshot': {
      const snapshot = buildSnapshot(deps.reg, {
        interactiveOnly: cmd.interactiveOnly,
        maxDepth: cmd.maxDepth,
        root: deps.root,
      })
      // Seed the diff baseline only AFTER the page settles. For a proxied Vite SPA the
      // dev-server runtime CSS (and first paint) land in the window between this snapshot
      // and the next action; seeding synchronously captures the UNSTYLED page (bg
      // transparent/black), so the next action's diff misattributes the late stylesheet's
      // color change to the action — a click that did nothing looks like a theme toggle
      // (a false positive). Settling first makes the baseline reflect the
      // painted, CSS-applied page. Same injectable settle the post-action resample uses.
      const settle = deps.settle ?? settleTransitions
      await settle()
      deps.prevTree.value = stateForDiff(deps.root)
      return { ok: true, result: { action: 'snapshot', snapshot } }
    }
    case 'console':
      return { ok: true, result: { action: 'console', console: deps.console.read() } }

    case 'evaluate': {
      const expr = cmd.expression
      if (expr == null || expr.trim() === '')
        return fail(
          'bad_request',
          '`evaluate` requires an `expression` (a JS expression run in the page).',
        )
      // Settle BEFORE reading. A prior action (or an earlier step of a `steps` batch) may
      // have queued an ASYNC framework commit — React's setState→useEffect flips
      // `data-theme` only a microtask + 2 rAF after the click. Reading synchronously
      // would return the OLD value, so a post-click `evaluate` gaslights the model into
      // thinking a WORKING toggle is broken. Settling first (the same
      // injectable 2-rAF settle the click action + snapshot baseline use) flushes the
      // commit so the read reflects it. NB: this cannot rescue a SINGLE expression that
      // both mutates and reads (e.g. `toggleTheme(); getAttr()` — the async commit is
      // queued DURING the expression, after this settle); steer that to the `steps` path
      // (click step settles, then an evaluate step reads) — see the tool docstring.
      const settle = deps.settle ?? settleTransitions
      await settle()
      let raw: unknown
      try {
        raw = await compileEvalExpression(expr)()
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        return fail('failed', `evaluate threw — ${msg}`)
      }
      return { ok: true, result: { action: 'evaluate', value: serializeEvalResult(raw) } }
    }

    case 'screenshot': {
      // Target an element (ref/selector), or the whole page body — or the root — when none given.
      const pageRoot = deps.root ?? document.body ?? document.documentElement
      let target: Element
      if (cmd.ref || cmd.selector) {
        const t = resolveTarget(cmd, deps.reg, deps.root)
        if (isFail(t)) return t
        target = t
      } else {
        target = pageRoot
      }
      // Centering the target makes a small element's shot readable in context — but
      // centering the PAGE ROOT just scrolls a tall page to its middle, which changes
      // what the person watching the preview is looking at and buys nothing (the
      // rasterizer renders the DOM, not the visible pixels). So the whole-page shot
      // leaves the scroll position exactly where it was.
      if (target !== pageRoot && target !== document.documentElement) {
        target.scrollIntoView?.({ block: 'center', inline: 'center' })
      }
      // Rasterize IN-PAGE (same origin) — no screen-share permission, works headless.
      // A whole-view shot is OF the view, so it takes no context margin. The margin makes a small
      // element readable among its neighbours; around a scoped root (a plugin panel inside the app)
      // it sent the rasterizer climbing to the app shell for pixels outside the panel, cloning the
      // whole window — and WebKit's per-image redraw pass made that ~16 s a shot.
      const image = await rasterizeElement(target, {
        ...(deps.backdrop ? { backgroundColor: deps.backdrop } : {}),
        ...(target === pageRoot ? { contextRatio: 0 } : {}),
      })
      return {
        ok: true,
        result: {
          action: 'screenshot',
          rect: getViewportRect(target),
          target: getElementSummary(target),
          ...(image ? { image } : { note: 'could not rasterize this element' }),
        },
      }
    }

    case 'scroll': {
      if (cmd.ref || cmd.selector) {
        const t = resolveWithHeal(cmd, deps)
        if (isHealFail(t)) return healFailResult('scroll', t)
        t.el.scrollIntoView({
          behavior: motionSafeScrollBehavior('smooth'),
          block: 'center',
        })
        return {
          ok: true,
          result: {
            action: 'scroll',
            rect: getViewportRect(t.el),
            target: getElementSummary(t.el),
            note: withHeal(`scrolled ${getElementSummary(t.el)} into view`, t),
            ...(await postAction(deps, snapAfter(cmd, t), consoleCursor)),
          },
        }
      }
      const scroller = deps.root ? scrollContainerIn(deps.root) : null
      const amt = cmd.amount ?? Math.round((scroller?.clientHeight ?? window.innerHeight) * 0.8)
      const dx = cmd.direction === 'left' ? -amt : cmd.direction === 'right' ? amt : 0
      const dy = cmd.direction === 'up' ? -amt : amt // default: down
      const by: ScrollToOptions = {
        left: dx,
        top: cmd.direction === 'left' || cmd.direction === 'right' ? 0 : dy,
        behavior: motionSafeScrollBehavior('smooth'),
      }
      if (scroller) scroller.scrollBy(by)
      else window.scrollBy(by)
      return {
        ok: true,
        result: {
          action: 'scroll',
          note: `scrolled ${cmd.direction ?? 'down'} ${amt}px`,
          ...(await postAction(deps, cmd.snapshotAfter, consoleCursor)),
        },
      }
    }

    case 'hover': {
      const t = resolveWithHeal(cmd, deps)
      if (isHealFail(t)) return healFailResult('hover', t)
      t.el.scrollIntoView({ block: 'center' })
      const { x, y } = centerPoint(t.el)
      // Hover the deepest node under the center too (a trusted hover targets it), so a
      // child-delegated mouseover handler fires; falls back to t.el.
      const hoverEl = hitTarget(t.el, x, y)
      dispatchPointer(hoverEl, 'pointerover', x, y)
      dispatchMouse(hoverEl, 'mouseover', x, y)
      dispatchMouse(hoverEl, 'mousemove', x, y)
      return {
        ok: true,
        result: {
          action: 'hover',
          rect: getViewportRect(t.el),
          target: getElementSummary(t.el),
          note: withHeal(`hovered ${getElementSummary(t.el)}`, t),
          ...(await postAction(deps, snapAfter(cmd, t), consoleCursor)),
        },
      }
    }

    case 'click': {
      const t = resolveWithHeal(cmd, deps)
      if (isHealFail(t)) return healFailResult('click', t)
      const target = t.el
      target.scrollIntoView({ block: 'center' })
      const blocker = occludedBy(target)
      if (blocker) {
        // A modal/overlay covers the target. Point the agent straight at the escape
        // hatch — its close control (if any) plus Escape — and attach a fresh snapshot
        // so the covering element's own [ref=eN]s are available to act on right away.
        const closer = findCloseControl(blocker)
        const hint = closer
          ? ` Dismiss it first: click ${getElementSummary(closer)} or press Escape, then retry.`
          : ' Dismiss it first (press Escape or click its close/dismiss control), then retry.'
        return {
          ok: false,
          errorCode: 'intercepted',
          error: `${getElementSummary(target)} is covered by ${getElementSummary(blocker)} (${getSemanticRole(blocker) ?? blocker.tagName.toLowerCase()}).${hint}`,
          result: { action: 'click', snapshot: buildSnapshot(deps.reg, { root: deps.root }) },
        }
      }
      synthClick(target)
      return {
        ok: true,
        result: {
          action: 'click',
          rect: getViewportRect(target),
          target: getElementSummary(target),
          note: withHeal(`clicked ${getElementSummary(target)}`, t),
          ...(await postAction(deps, snapAfter(cmd, t), consoleCursor)),
        },
      }
    }

    case 'type': {
      const t = resolveWithHeal(cmd, deps)
      if (isHealFail(t)) return healFailResult('type', t)
      if (cmd.text == null) return fail('bad_request', '`type` requires `text`.')
      fillValue(t.el, cmd.text)
      return {
        ok: true,
        result: {
          action: 'type',
          rect: getViewportRect(t.el),
          target: getElementSummary(t.el),
          note: withHeal(`typed into ${getElementSummary(t.el)}`, t),
          ...(await postAction(deps, snapAfter(cmd, t), consoleCursor)),
        },
      }
    }

    case 'press': {
      // Accept a single `key` or a `keys` SEQUENCE (sent in order, one round-trip).
      const keys = cmd.keys?.length ? cmd.keys : cmd.key ? [cmd.key] : null
      if (!keys) return fail('bad_request', '`press` requires `key` or `keys`.')
      let target: Element | undefined
      let heal: Healed | undefined
      if (cmd.ref || cmd.selector) {
        const t = resolveWithHeal(cmd, deps)
        if (isHealFail(t)) return healFailResult('press', t)
        target = t.el
        heal = t
      }
      // Untargeted keys go where a keyboard sends them: the element focused NOW, which a
      // Tab earlier in the same sequence may have just changed — inside the root, when there is one.
      const focused = () => {
        const active = document.activeElement
        if (!deps.root) return active ?? document.body
        return active && deps.root.contains(active) ? active : deps.root
      }
      for (const k of keys) pressKey(target ?? focused(), k, deps.root)
      return {
        ok: true,
        result: {
          action: 'press',
          note: withHeal(`pressed ${keys.join(' ')}`, heal),
          ...(await postAction(deps, snapAfter(cmd, heal), consoleCursor)),
        },
      }
    }

    case 'steps': {
      // Run an ordered batch of interactions in one call. Each step runs WITHOUT its
      // own snapshot (cheap diff only); a single postAction at the end optionally
      // returns the final page. Stops at the first failing step (self-heal applies
      // per step, so a stale ref mid-batch recovers instead of aborting the run). A
      // `snapshot` step IS allowed — its fresh tree is carried out on the batch result
      // (last snapshot wins), so the natural act-then-observe batch `[{click…},{snapshot}]`
      // returns the new page in ONE call without needing `snapshotAfter`.
      const steps = cmd.steps ?? []
      if (!steps.length) return fail('bad_request', '`steps` requires a non-empty array.')
      const notes: string[] = []
      let stepSnapshot: VfSnapshot | undefined
      for (let i = 0; i < steps.length; i++) {
        const sub = await dispatch({ ...steps[i], snapshotAfter: false } as VfCommand, {
          ...deps,
          inBatch: true,
        })
        if (!sub.ok) {
          return failedStep(steps, i, notes, sub)
        }
        if (sub.result?.action === 'snapshot' && sub.result.snapshot)
          stepSnapshot = sub.result.snapshot
        notes.push(stepNote(steps[i].action, sub.result))
      }
      // The outer cursor was captured before the first step → recentErrors spans the batch.
      const tail = await postAction(deps, cmd.snapshotAfter, consoleCursor)
      // Fold in a `snapshot` step's tree when the batch didn't already produce one via
      // `snapshotAfter`, so `[{click},{snapshot}]` hands back the fresh page in one call.
      const snapshot = tail.snapshot ?? stepSnapshot
      return {
        ok: true,
        result: {
          action: 'steps',
          note: notes.join(' → '),
          ...tail,
          ...(snapshot ? { snapshot } : {}),
        },
      }
    }
  }
}
