import type { VfCommand } from '../protocol/index'
import type { ActuateDeps, PreparedActionResult } from './types'
import { pressKey } from './input'
import { fail, resolveWithHeal, isHealFail, healFailResult, withHeal, snapAfter } from './target'
import type { Healed } from './target'

/** Dispatch a key sequence synchronously, resolving untargeted focus for each key. */
export function performPress(cmd: VfCommand, deps: ActuateDeps): PreparedActionResult {
  // Accept a single `key` or a `keys` SEQUENCE (sent in order, one round-trip).
  const keys = cmd.keys?.length ? cmd.keys : cmd.key ? [cmd.key] : null
  if (!keys) return { ok: false, failure: fail('bad_request', '`press` requires `key` or `keys`.') }
  let target: Element | undefined
  let heal: Healed | undefined
  if (cmd.ref || cmd.selector) {
    const t = resolveWithHeal(cmd, deps)
    if (isHealFail(t)) return { ok: false, failure: healFailResult('press', t) }
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
    },
    snapshotAfter: snapAfter(cmd, heal),
  }
}
