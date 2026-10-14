import { afterAll, beforeAll, expect, test } from 'bun:test'
import { useRef } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { useSettingsAnchorMaterializer } from './useSettingsAnchorMaterializer'
import { __resetUiTargets, revealUiTarget } from '@/shared/lib/uiTargetRegistry'
import { settingsTargetUri } from '@/shared/lib/settingsAnchors'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

function Fixture() {
  const ref = useRef<HTMLDivElement>(null)
  useSettingsAnchorMaterializer(ref)
  return (
    <div ref={ref}>
      <div data-settings-anchor="prefs-notifications-advanced" data-settings-reveal>
        <CollapsibleSection title="Advanced" defaultOpen={false}>
          Terminal compatibility
        </CollapsibleSection>
      </div>
      <div data-settings-anchor="other">
        <CollapsibleSection title="Other" defaultOpen={false}>
          Unrelated settings
        </CollapsibleSection>
      </div>
    </div>
  )
}

test('settings navigation reveals indexed advanced controls without opening unrelated disclosures', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  __resetUiTargets()
  try {
    await act(async () => root.render(<Fixture />))
    const trigger = () => host.querySelector('button[aria-expanded]')!
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      expect(
        await revealUiTarget(
          settingsTargetUri({ tab: 'preferences', anchor: 'prefs-notifications-advanced' }),
          { behavior: 'auto', flashClassName: '', focus: false },
        ),
      ).toBe(true)
    })
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    await act(async () => {
      expect(
        await revealUiTarget(settingsTargetUri({ tab: 'preferences', anchor: 'other' }), {
          behavior: 'auto',
          flashClassName: '',
          focus: false,
        }),
      ).toBe(true)
    })
    expect(
      host.querySelector('[data-settings-anchor="other"] button')?.getAttribute('aria-expanded'),
    ).toBe('false')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    __resetUiTargets()
  }
})
