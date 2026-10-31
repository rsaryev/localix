/**
 * The `select` action: choose an option of a native dropdown by its value or its visible label.
 * Set through the native `value` setter (so a framework's value tracker sees it), then `input`
 * and `change` like a person's pick. Choosing what is already chosen fires nothing, as in a
 * browser, and says so. It never opens the popup: a native one is drawn by the system, not the page.
 */

import { getViewportRect } from '../core/geometry'
import { getElementSummary } from '../core/identify'
import type { VfCommand } from '../protocol/index'
import { enabledOptions, optionsSuffix, type SelectOption } from '../snapshot/field'
import { postAction } from './post-action'
import { fail, healFailResult, isHealFail, resolveWithHeal, snapAfter, withHeal } from './target'
import type { ActuateDeps, ActuateResult } from './types'

/** Exact value first, then the label (any case): a model may send either from the snapshot. */
function findOption(options: SelectOption[], wanted: string): SelectOption | undefined {
  const lower = wanted.trim().toLowerCase()
  return (
    options.find((o) => o.value === wanted) ??
    options.find((o) => o.label === wanted.trim()) ??
    options.find((o) => o.label.toLowerCase() === lower)
  )
}

function setNativeSelectValue(select: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
  if (descriptor?.set) descriptor.set.call(select, value)
  else select.value = value
}

export async function performSelect(
  cmd: VfCommand,
  deps: ActuateDeps,
  consoleCursor: number,
): Promise<ActuateResult> {
  const t = resolveWithHeal(cmd, deps)
  if (isHealFail(t)) return healFailResult('select', t)
  if (cmd.text == null)
    return fail('bad_request', '`select` requires `text` (an option value or label).')
  const select = t.el
  if (!(select instanceof HTMLSelectElement)) return fail('failed', 'not a dropdown')

  const options = enabledOptions(select)
  const chosen = findOption(options, cmd.text)
  if (!chosen) {
    const offered = optionsSuffix(select).replace(/^ options: /, '') || '(none enabled)'
    return fail('failed', `no such option: ${cmd.text} (options: ${offered})`)
  }

  const summary = getElementSummary(select)
  const label = chosen.label || chosen.value
  const unchanged = select.selectedIndex === chosen.index
  if (!unchanged) {
    select.focus?.()
    setNativeSelectValue(select, chosen.value)
    // Duplicate values leave the first match selected; the option itself decides.
    if (select.selectedIndex !== chosen.index) select.options[chosen.index].selected = true
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return {
    ok: true,
    result: {
      action: 'select',
      rect: getViewportRect(select),
      target: summary,
      note: withHeal(
        unchanged
          ? `"${label}" already selected in ${summary}`
          : `selected "${label}" in ${summary}`,
        t,
      ),
      ...(await postAction(deps, snapAfter(cmd, t), consoleCursor)),
    },
  }
}
