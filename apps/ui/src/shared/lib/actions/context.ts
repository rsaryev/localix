/**
 * Synchronous action context sampled at dispatch time.
 *
 * Two different questions, answered from two different places on purpose. What the EVENT TARGET is
 * — an input, a selection, which region of the shell — is read from committed DOM, so a
 * workspace shortcut sees the same focus reality the browser routes the key through.
 * Whether an OVERLAY owns the keyboard is read from the focus stack instead.
 *
 * That second one used to be a `querySelector` for `[data-radix-popper-content-wrapper]`, and the
 * problem with it was not that it was ugly: a third-party library's internal wrapper class was
 * standing in for a product decision, so a surface that owned the keyboard without rendering that
 * markup was invisible, and a library upgrade that renamed the class would have silently re-enabled
 * every global shortcut with nothing failing. The stack is claimed by the overlay primitives
 * themselves, which is the thing that is actually true.
 */
import { overlayOnScreen, useFocusStack } from '@localixai/mini-app-sdk/ui/focus'

export interface ActionContext {
  inputFocus: boolean
  hasSelection: boolean
  menuOpen: boolean
  chatFocus: boolean
  editorFocus: boolean
  sidebarFocus: boolean
}

/**
 * The event's target as an element, or `null`.
 *
 * A keydown delivered straight to `window` — which is what a programmatic dispatch produces, and
 * what a page with nothing focused can produce — has the Window as its target, and Window has no
 * `closest`. Reading it as an element threw from inside the capture-phase listener, where the
 * exception is invisible: the browser logs it and swallows it, and every shortcut after that point
 * in the handler simply never runs.
 */
function asElement(target: EventTarget | null): HTMLElement | null {
  return target !== null && typeof (target as HTMLElement).closest === 'function'
    ? (target as HTMLElement)
    : null
}

function editable(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  const element = asElement(target)
  if (!element) return false
  const contentEditable = element.closest('[contenteditable]')?.getAttribute('contenteditable')
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable ||
    (contentEditable !== undefined && contentEditable !== 'false') ||
    element.closest('[role="textbox"]') !== null
  )
}

function selected(target: EventTarget | null): boolean {
  if (!editable(target)) return false
  const element = target as unknown as HTMLElement
  if (element.isContentEditable) return Boolean(window.getSelection()?.toString())
  const input = element as HTMLInputElement | HTMLTextAreaElement
  return (
    typeof input.selectionStart === 'number' &&
    typeof input.selectionEnd === 'number' &&
    input.selectionStart !== input.selectionEnd
  )
}

export function actionContextFromTarget(target: EventTarget | null): ActionContext {
  const element = asElement(target)
  const part = element?.closest<HTMLElement>('[data-focus-part]')?.dataset.focusPart
  return {
    inputFocus: editable(target),
    hasSelection: selected(target),
    menuOpen: overlayOnScreen(useFocusStack.getState().entries),
    chatFocus: part === 'chat',
    editorFocus: part === 'editor',
    sidebarFocus: part === 'sidebar',
  }
}

/**
 * Small, intentionally boolean-only when-clause language:
 * `!inputFocus`, `editorFocus && !menuOpen`, `chatFocus || editorFocus`.
 * Unknown keys are false, so a typo disables an action instead of broadening it.
 */
export function evaluateActionWhen(when: string | undefined, context: ActionContext): boolean {
  if (!when?.trim()) return true
  return when.split(/\s*\|\|\s*/u).some((group) =>
    group.split(/\s*&&\s*/u).every((rawTerm) => {
      const term = rawTerm.trim()
      if (!term) return false
      const negated = term.startsWith('!')
      const key = (negated ? term.slice(1) : term) as keyof ActionContext
      if (!Object.hasOwn(context, key)) return false
      const value = context[key]
      return negated ? !value : value
    }),
  )
}
