import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsActionActivity } from './SettingsActionActivity'

test('settings actions share one compact activity treatment', () => {
  const html = renderToStaticMarkup(<SettingsActionActivity label="Saving server…" />)

  expect(html).toContain('lx-activity-orb')
  expect(html).toContain('Saving server')
  expect(html).not.toContain('Saving server…')
  expect(html).toContain('text-current')
})
