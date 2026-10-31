import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingProblems } from './SettingProblems'

describe('settings problems', () => {
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
})
