/**
 * Form FIELDS in the snapshot: a field's label and its current value, read apart.
 *
 * The tree used to name a field by its value, else its placeholder — so the agent could not tell
 * the label "Where to?" from the text "London", nor an empty field from a filled one. A field is
 * now named by its label (aria-label, aria-labelledby, an associated or wrapping <label>, then
 * placeholder, title, name) and its value is shown separately (`= "London"`). A password's value is
 * never read; a checkbox or radio keeps its state (`[checked]`) instead of a value.
 */

/** Native input types that do not take typed text. */
const NON_TEXT_INPUT = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'range',
  'color',
  'hidden',
])
/** Roles of custom controls that accept typing. */
const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox'])

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

const tagOf = (el: Element) => el.tagName.toLowerCase()
/** The root of a contenteditable region (its descendants inherit it, but only the root is a field). */
export const isEditableRoot = (el: Element) => {
  const value = el.getAttribute('contenteditable')
  return value !== null && value !== 'false'
}
const inputType = (el: Element) => (el.getAttribute('type') ?? 'text').toLowerCase()

/** Whether `el` is a form field whose name comes from its label (and whose value is shown apart). */
export function isField(el: Element): boolean {
  const tag = tagOf(el)
  if (tag === 'textarea' || tag === 'select') return true
  if (tag === 'input') return !['button', 'submit', 'reset', 'image'].includes(inputType(el))
  if (isEditableRoot(el)) return true
  return TEXT_ROLES.has(el.getAttribute('role') ?? '')
}

/** Whether `el` takes typed text: what a "type" step can fill. */
export function isEditable(el: Element): boolean {
  const tag = tagOf(el)
  if (tag === 'textarea') return true
  if (tag === 'input') return !NON_TEXT_INPUT.has(inputType(el))
  if (tag === 'select') return false
  if (isEditableRoot(el)) return true
  return TEXT_ROLES.has(el.getAttribute('role') ?? '')
}

/**
 * A combobox drawn as a wrapper around its one text field (the ARIA 1.1 pattern): that field,
 * else null. The snapshot names and fills the wrapper through it, since the wrapper is a leaf
 * of the tree and the field inside would otherwise never be seen.
 */
export function wrappedField(el: Element): Element | null {
  if (el.getAttribute('role') !== 'combobox') return null
  const tag = tagOf(el)
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || isEditableRoot(el)) return null
  const fields = Array.from(el.querySelectorAll('input,textarea')).filter(isEditable)
  return fields.length === 1 ? fields[0]! : null
}

/** Visible text of a label-ish element, without its own form controls' values. */
function textOf(el: Element | null): string {
  return el ? collapse(el.textContent ?? '') : ''
}

/** A field's label: what it is for, never what is typed in it. */
export function fieldLabel(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return clip(collapse(aria))
  const doc = el.ownerDocument
  const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => textOf(doc.getElementById(id)))
    .filter(Boolean)
    .join(' ')
  if (labelledBy) return clip(labelledBy)
  const id = el.getAttribute('id')
  if (id) {
    const label = Array.from(doc.querySelectorAll('label')).find(
      (candidate) => candidate.getAttribute('for') === id,
    )
    if (label && textOf(label)) return clip(textOf(label))
  }
  const wrapping = el.closest('label')
  if (wrapping) {
    // The wrapping label's own text, not the field's value inside it.
    const own = Array.from(wrapping.childNodes)
      .filter((node) => node !== el && !(node instanceof Element && node.contains(el)))
      .map((node) => node.textContent ?? '')
      .join(' ')
    if (collapse(own)) return clip(collapse(own))
  }
  const inner = wrappedField(el)
  if (inner) return fieldLabel(inner)
  const fallback =
    el.getAttribute('placeholder') ?? el.getAttribute('title') ?? el.getAttribute('name') ?? ''
  return clip(collapse(fallback))
}

/** A field's current value, or '' — never a password's; checkboxes and radios have state instead. */
export function fieldValue(el: Element): string {
  const inner = wrappedField(el)
  if (inner) return fieldValue(inner)
  const tag = tagOf(el)
  if (tag === 'select') {
    const select = el as HTMLSelectElement
    const option = select.options?.[select.selectedIndex]
    return option ? clip(collapse(option.textContent ?? '')) : ''
  }
  if (tag === 'input') {
    const type = inputType(el)
    if (type === 'password' || NON_TEXT_INPUT.has(type)) return ''
    return clip(collapse((el as HTMLInputElement).value ?? ''))
  }
  if (tag === 'textarea') return clip(collapse((el as HTMLTextAreaElement).value ?? ''))
  if (isEditableRoot(el)) return clip(collapse(el.textContent ?? ''))
  return ''
}

/** States beyond disabled/checked: expanded/collapsed, selected, required, readonly. */
export function extraStates(el: Element): string[] {
  const states: string[] = []
  const expanded = el.getAttribute('aria-expanded')
  if (expanded === 'true') states.push('expanded')
  else if (expanded === 'false') states.push('collapsed')
  if (el.getAttribute('aria-selected') === 'true' || (el as HTMLOptionElement).selected)
    states.push('selected')
  if ((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true')
    states.push('required')
  if ((el as HTMLInputElement).readOnly || el.getAttribute('aria-readonly') === 'true')
    states.push('readonly')
  return states
}

/** Options a snapshot line offers: at most this many, so a country list does not flood it. */
export const MAX_SELECT_OPTIONS = 50

/** One option as a person reads it: its visible label (the `label` attribute wins) and value. */
export interface SelectOption {
  value: string
  label: string
  index: number
}

/** The options of a native dropdown a person could pick: enabled ones, with label and value. */
export function enabledOptions(select: HTMLSelectElement): SelectOption[] {
  const found: SelectOption[] = []
  Array.from(select.options ?? []).forEach((option, index) => {
    if (option.disabled || option.parentElement?.closest('optgroup[disabled]')) return
    const label = collapse(option.getAttribute('label') ?? option.textContent ?? '')
    found.push({ value: option.value, label, index })
  })
  return found
}

/**
 * ` options: "France" (fr), "Spain"` for a dropdown, '' for anything else. The value is shown
 * only when it differs from the label; past {@link MAX_SELECT_OPTIONS} the rest are counted.
 */
export function optionsSuffix(el: Element): string {
  if (tagOf(el) !== 'select') return ''
  const all = enabledOptions(el as HTMLSelectElement)
  if (!all.length) return ''
  const shown = all.slice(0, MAX_SELECT_OPTIONS).map((o) => {
    const label = `"${clip(o.label, 60)}"`
    return o.value && o.value !== o.label ? `${label} (${clip(o.value, 40)})` : label
  })
  if (all.length > MAX_SELECT_OPTIONS) shown.push(`… ${all.length - MAX_SELECT_OPTIONS} more`)
  return ` options: ${shown.join(', ')}`
}
