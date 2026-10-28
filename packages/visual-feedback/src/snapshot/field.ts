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
  const fallback =
    el.getAttribute('placeholder') ?? el.getAttribute('title') ?? el.getAttribute('name') ?? ''
  return clip(collapse(fallback))
}

/** A field's current value, or '' — never a password's; checkboxes and radios have state instead. */
export function fieldValue(el: Element): string {
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
