import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  SettingProblems,
  SettingRegistryList,
  SettingRegistryMeta,
  SettingRegistryRow,
  shouldShowRegistryEmptyState,
} from './settingRegistry'

describe('settings capability registry', () => {
  test('shows an empty state only after a successful settled load', () => {
    expect(shouldShowRegistryEmptyState({ count: 0, loading: false, error: null })).toBe(true)
    expect(
      shouldShowRegistryEmptyState({ count: 0, loading: false, error: 'Failed to load' }),
    ).toBe(false)
    expect(shouldShowRegistryEmptyState({ count: 0, loading: true, error: null })).toBe(false)
    expect(shouldShowRegistryEmptyState({ count: 1, loading: false, error: null })).toBe(false)
  })

  test('reports a recoverable failure as one problem line with a retry action', () => {
    const html = renderToStaticMarkup(
      <SettingProblems subject="Plugins" errors={['Failed to load plugins']} onRetry={() => {}} />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('Failed to load plugins')
    expect(html).toContain('>Details</button>')
    expect(html).toContain('>Retry</button>')
  })

  test('says nothing, on the surface or in the centre, when nothing is wrong', () => {
    expect(renderToStaticMarkup(<SettingProblems subject="Plugins" />)).toBe('')
  })

  test('renders rows as a list whose items carry their state', () => {
    const html = renderToStaticMarkup(
      <SettingRegistryList>
        <SettingRegistryRow
          state="enabled"
          header={<span>Review tools</span>}
          actions={<button type="button">Configure</button>}
          toggle={<button type="button">Toggle</button>}
        />
        <SettingRegistryRow
          state="disabled"
          header={<span>Terminal bridge</span>}
          toggle={<button type="button">Toggle</button>}
        />
      </SettingRegistryList>,
    )

    expect(html).toContain('role="list"')
    expect(html.match(/role="listitem"/g)).toHaveLength(2)
    expect(html).toContain('data-state="enabled"')
    expect(html).toContain('data-state="disabled"')
  })

  test('announces an in-flight mutation as busy status', () => {
    const html = renderToStaticMarkup(
      <SettingRegistryRow
        state="enabled"
        busyLabel="Updating Review tools"
        header={<span>Review tools</span>}
        toggle={<button type="button">Toggle</button>}
      />,
    )

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('data-state="busy"')
    expect(html).toContain('role="status"')
    expect(html).toContain('Updating Review tools')
  })

  test('marks warning and error rows without requiring a toggle', () => {
    const html = renderToStaticMarkup(
      <SettingRegistryList>
        <SettingRegistryRow state="warning" header={<span>Stale skill</span>} />
        <SettingRegistryRow state="error" header={<span>Invalid skill</span>} />
      </SettingRegistryList>,
    )

    expect(html).toContain('data-state="warning"')
    expect(html).toContain('data-state="error"')
  })

  test('renders every registry fact label', () => {
    const html = renderToStaticMarkup(
      <SettingRegistryMeta
        items={[{ label: 'v1.2.0' }, { label: 'Global' }, { label: 'in-process', tone: 'warning' }]}
      />,
    )

    expect(html).toContain('v1.2.0')
    expect(html).toContain('Global')
    expect(html).toContain('in-process')
  })
})
