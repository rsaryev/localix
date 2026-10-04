import { activeEventOrigin } from './context'
import type { NotificationOrigin } from './types'

export type UserIntentKind = 'click' | 'keyboard' | 'submit'

export interface UserIntentContext {
  ts: number
  kind: UserIntentKind
  /** Accessible control identity only; field values and surrounding text are never captured. */
  control: string
  origin: NotificationOrigin
}

const USER_INTENT_TTL_MS = 2_000
const CONTROL_LABEL_MAX = 120
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
].join(',')

let latestIntent: UserIntentContext | null = null

function compactLabel(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, CONTROL_LABEL_MAX)
}

function controlIdentity(target: EventTarget | null): string | null {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return null
  const element = target.closest(INTERACTIVE_SELECTOR)
  if (!element) return null
  const role = compactLabel(element.getAttribute('role') ?? element.tagName.toLocaleLowerCase())
  const label = compactLabel(
    element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '',
  )
  if (label) return `${role}:${label}`
  if (element instanceof HTMLInputElement && element.type) return `${role}:${element.type}`
  return role
}

function recordIntent(kind: UserIntentKind, target: EventTarget | null, ts = Date.now()): void {
  const control = controlIdentity(target)
  if (!control) return
  latestIntent = { ts, kind, control, origin: activeEventOrigin() }
}

/**
 * Captures user intent once at the document boundary. Request instrumentation can
 * then distinguish an interactive read from background polling without every
 * feature annotating its own API calls.
 */
export function startUserIntentCapture(target: Document = document): () => void {
  const onClick = (event: MouseEvent) => recordIntent('click', event.target)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') recordIntent('keyboard', event.target)
  }
  const onSubmit = (event: SubmitEvent) => {
    recordIntent('submit', event.submitter ?? target.activeElement ?? event.target)
  }
  target.addEventListener('click', onClick, true)
  target.addEventListener('keydown', onKeyDown, true)
  target.addEventListener('submit', onSubmit, true)
  return () => {
    target.removeEventListener('click', onClick, true)
    target.removeEventListener('keydown', onKeyDown, true)
    target.removeEventListener('submit', onSubmit, true)
  }
}

export function recentUserIntent(now = Date.now()): UserIntentContext | null {
  if (!latestIntent || now < latestIntent.ts || now - latestIntent.ts > USER_INTENT_TTL_MS) {
    return null
  }
  return { ...latestIntent, origin: { ...latestIntent.origin } }
}

export function resetUserIntentForTests(): void {
  latestIntent = null
}
