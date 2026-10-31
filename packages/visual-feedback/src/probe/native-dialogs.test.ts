/**
 * Native pages are the person's own browsing too: a dialog is answered by the page's own
 * `alert`/`confirm`/`prompt` unless an agent command is in flight, and then it is cancelled and
 * reported, never accepted.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { installConsoleCapture } from '../actuate/index'
import { installScopedDialogGuard } from '../actuate/dialog-guard'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

test('outside a command the person gets the page dialogs untouched', () => {
  const calls: string[] = []
  const saved = { alert: window.alert, confirm: window.confirm, prompt: window.prompt }
  window.alert = (m?: unknown) => void calls.push(`alert:${String(m)}`)
  window.confirm = (m?: unknown) => (calls.push(`confirm:${String(m)}`), true)
  window.prompt = (m?: unknown) => (calls.push(`prompt:${String(m)}`), 'Ada')
  const cap = installConsoleCapture()
  const guard = installScopedDialogGuard(cap)
  try {
    const at = cap.cursor()
    window.alert('hi')
    expect(window.confirm('sure?')).toBe(true)
    expect(window.prompt('name?')).toBe('Ada')
    expect(calls).toEqual(['alert:hi', 'confirm:sure?', 'prompt:name?'])
    expect(cap.read(at)).toEqual([])
  } finally {
    guard.uninstall()
    cap.uninstall()
    Object.assign(window, saved)
  }
})

test('while a command is in flight dialogs are cancelled, reported, and never reach the person', () => {
  const calls: string[] = []
  const saved = { alert: window.alert, confirm: window.confirm, prompt: window.prompt }
  window.alert = (m?: unknown) => void calls.push(`alert:${String(m)}`)
  window.confirm = (m?: unknown) => (calls.push(`confirm:${String(m)}`), true)
  window.prompt = (m?: unknown) => (calls.push(`prompt:${String(m)}`), 'Ada')
  const cap = installConsoleCapture()
  const guard = installScopedDialogGuard(cap)
  try {
    const at = cap.cursor()
    const release = guard.hold()
    expect(window.alert('boom')).toBeUndefined()
    expect(window.confirm('Delete everything?')).toBe(false)
    expect(window.prompt('Your name?')).toBeNull()
    expect(calls).toEqual([])
    expect(cap.read(at).map((e) => e.text)).toEqual([
      '[dialog] alert("boom") cancelled',
      '[dialog] confirm("Delete everything?") cancelled',
      '[dialog] prompt("Your name?") cancelled',
    ])
    release()
    expect(window.confirm('later')).toBe(true)
    expect(calls).toEqual(['confirm:later'])
  } finally {
    guard.uninstall()
    cap.uninstall()
    Object.assign(window, saved)
  }
})

test('overlapping commands keep dialogs cancelled until the last one is done', () => {
  const cap = installConsoleCapture()
  const saved = { confirm: window.confirm }
  window.confirm = () => true
  const guard = installScopedDialogGuard(cap)
  try {
    const first = guard.hold()
    const second = guard.hold()
    first()
    first() // releasing twice must not release the other command
    expect(window.confirm('x')).toBe(false)
    second()
    expect(window.confirm('x')).toBe(true)
  } finally {
    guard.uninstall()
    cap.uninstall()
    Object.assign(window, saved)
  }
})
