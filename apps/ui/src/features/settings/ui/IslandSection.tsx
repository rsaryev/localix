import { useEffect, useState } from 'react'
import { isDesktop, IS_MAC } from '@localixai/kit/environment'
import { tauriInvoke } from '@/shared/lib/tauri'
import { SettingsRows, SettingsSection } from './SettingsScaffold'
import { SwitchRow } from './SwitchRow'

/** Settings → Preferences → Agent island: the desktop shell's quick chat at the notch. */
export function IslandSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    if (!isDesktop || !IS_MAC) return
    let alive = true
    void tauriInvoke()?.('island_enabled')
      .then((value) => {
        if (alive && typeof value === 'boolean') setEnabled(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  if (!isDesktop || !IS_MAC || enabled === null) return null
  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    void tauriInvoke()?.('set_island_enabled', { enabled: next }).catch(() => setEnabled(!next))
  }
  return (
    <SettingsSection
      anchor="prefs-island"
      title="Agent island"
      scope="device"
      description="A quick chat at the top of the screen that shows when agents work or need you."
    >
      <SettingsRows>
        <SwitchRow
          title="Show the agent island"
          description="Hover the notch or press Cmd+Shift+J. When off, the shortcut and the Quick Chat menu item are hidden too."
          checked={enabled}
          onChange={toggle}
          label="Show the agent island"
        />
      </SettingsRows>
    </SettingsSection>
  )
}
