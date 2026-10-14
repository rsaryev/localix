import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivitySignal, activityOrbState, cleanActivityLabel } from './activity-orb'
import { LoadingHint } from './empty-hint'
import { Spinner } from './spinner'

describe('Localix activity primitive', () => {
  test('maps cognitive phases without changing the public label', () => {
    expect(activityOrbState('Thinking')).toBe('thinking')
    expect(activityOrbState('Analyzing repository')).toBe('thinking')
    expect(activityOrbState('Running command')).toBe('working')
    expect(cleanActivityLabel('Working……')).toBe('Working')
  })

  test('renders one persistent orb plus the accessible clean label', () => {
    const html = renderToStaticMarkup(<ActivitySignal label="Thinking…" />)

    expect(html).toContain('data-state="thinking"')
    expect(html).toContain('lx-activity-label-in')
    expect(html).toContain('>Thinking</span>')
    expect(html).not.toContain('Thinking…')
  })

  test('uses the same orb for compact and full-surface loaders', () => {
    const spinner = renderToStaticMarkup(<Spinner size="md" />)
    const hint = renderToStaticMarkup(<LoadingHint>Loading workspace…</LoadingHint>)

    expect(spinner).toContain('aria-hidden="true"')
    expect(spinner).not.toContain('role="status"')
    expect(spinner).toContain('data-state="working"')
    expect(spinner).toContain('lx-activity-orb')
    expect(spinner).not.toContain('animate-spin')
    expect(hint).toContain('role="status"')
    expect(hint).toContain('lx-activity-orb')
    expect(hint).toContain('>Loading workspace</span>')
    expect(hint).not.toContain('Loading workspace…')
  })
})
