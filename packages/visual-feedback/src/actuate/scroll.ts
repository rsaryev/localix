import type { VfCommand, VfCommandResult } from '../protocol/index'
import { getElementSummary } from '../core/identify'
import { getViewportRect, scrollContainerIn } from '../core/geometry'
import { motionSafeScrollBehavior } from '../core/motion'
import type { ActuateDeps, ActuateResult } from './types'
import { resolveWithHeal, isHealFail, healFailResult, withHeal, snapAfter } from './target'

type ScrollResult =
  | { ok: true; result: VfCommandResult; snapshotAfter: boolean | undefined }
  | { ok: false; failure: ActuateResult }

/** Perform the synchronous scroll; the dispatcher settles and samples afterward. */
export function performScroll(cmd: VfCommand, deps: ActuateDeps): ScrollResult {
  if (cmd.ref || cmd.selector) {
    const t = resolveWithHeal(cmd, deps)
    if (isHealFail(t)) return { ok: false, failure: healFailResult('scroll', t) }
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
      },
      snapshotAfter: snapAfter(cmd, t),
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
    },
    snapshotAfter: cmd.snapshotAfter,
  }
}
