import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { SystemNotice } from '../model/types'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

async function render(notice: SystemNotice, onRetry?: () => void, repeatCount?: number) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { SystemNoticeLine } = await import('./SystemNoticeLine')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<SystemNoticeLine notice={notice} onRetry={onRetry} repeatCount={repeatCount} />)
  })
  return {
    host,
    button: () => host.querySelector('button'),
    async cleanup() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const interrupted: SystemNotice = {
  kind: 'run_interrupted',
  tone: 'warning',
  text: 'Backend restarted — this reply is incomplete.',
  recovery: ['retry'],
}

describe('a notice that can be acted on', () => {
  /**
   * The gap this closes. The transcript's one line that asked for a decision was also the
   * only line with no way to make it: the copy said "send again", and the reader had to
   * know that meant retyping, or find Regenerate in a hover menu on the row above.
   */
  test('offers the recovery it names', async () => {
    let retried = 0
    const view = await render(
      interrupted,
      () => {
        retried += 1
      },
      3,
    )
    try {
      const button = view.button()
      expect(button?.textContent).toContain('Retry')
      expect(view.host.textContent).toContain('×3')
      button?.click()
      expect(retried).toBe(1)
    } finally {
      await view.cleanup()
    }
  })

  test('an ordinary notice stays a line, not a control', async () => {
    const view = await render({ kind: 'model_change', tone: 'neutral', text: 'Model changed' })
    try {
      expect(view.button()).toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test('no handler, no button — a surface that cannot re-run must not offer to', async () => {
    // A read-only transcript (a sub-agent's, a shared session) renders the same notice.
    const view = await render(interrupted)
    try {
      expect(view.button()).toBeNull()
      expect(view.host.textContent).toContain('this reply is incomplete')
    } finally {
      await view.cleanup()
    }
  })

  test('a mode line is drawn in the mode it switched to', async () => {
    // Drawn by kind alone, every mode was the same shield in the same tone: a switch to
    // Autonomous read exactly like a switch back to Default.
    const view = await render({
      kind: 'permission_mode_change',
      tone: 'info',
      text: 'Permission mode set to Autonomous.',
      mode: 'autonomous',
    })
    try {
      const line = view.host.querySelector('[role="status"]')
      expect(line?.className).toContain('text-status-error')
      expect(line?.querySelector('svg')?.getAttribute('class')).toContain('lucide-zap')
    } finally {
      await view.cleanup()
    }
  })

  test('a mode line stored without its mode keeps the generic look', async () => {
    const view = await render({
      kind: 'permission_mode_change',
      tone: 'info',
      text: 'Permission mode set to Plan.',
    })
    try {
      const line = view.host.querySelector('[role="status"]')
      expect(line?.className).toContain('text-text-soft')
      expect(line?.querySelector('svg')?.getAttribute('class')).toContain('lucide-shield-check')
    } finally {
      await view.cleanup()
    }
  })

  test('an actionable notice is not clamped to one line', async () => {
    // Its text is what the reader has to weigh BEFORE pressing the button beside it — the
    // pending-tool warning ends in "Check before retrying", which the clamp ate.
    const view = await render(
      { ...interrupted, text: 'Backend restarted while bash was still running — check first.' },
      () => {},
    )
    try {
      const label = view.host.querySelector('span')
      expect(label?.className).not.toContain('truncate')
    } finally {
      await view.cleanup()
    }
  })
})
