import { DesktopUpdateSection } from './DesktopUpdateSection'
import { ShellCommandRow } from './ShellCommandRow'
import { StorageSection } from './StorageSection'
import { SettingsPage, SettingsRows, SettingsSection } from './SettingsScaffold'
import { TabBar } from '@localixai/kit/tabs'
import { ContextSettings } from './ContextSettings'
import { DiagnosticsSettings } from './DiagnosticsSettings'

export type SystemSettingsTab = 'system' | 'context' | 'diagnostics'

/** Keep application maintenance, global policy and read-only diagnostics in one destination. */
export function SystemSettings({
  activeTab = 'system',
  onTabChange,
}: {
  activeTab?: SystemSettingsTab
  onTabChange?: (tab: SystemSettingsTab) => void
}) {
  return (
    <SettingsPage
      title="System"
      description="Application maintenance, access policies, and runtime diagnostics."
      tabs={
        <TabBar
          aria-label="System categories"
          items={[
            { id: 'system', label: 'Application' },
            { id: 'context', label: 'Access & context' },
            { id: 'diagnostics', label: 'Diagnostics' },
          ]}
          active={activeTab}
          onChange={(tab) => onTabChange?.(tab)}
        />
      }
    >
      {activeTab === 'context' ? (
        <ContextSettings />
      ) : activeTab === 'diagnostics' ? (
        <DiagnosticsSettings embedded />
      ) : (
        <div className="space-y-8">
          <DesktopUpdateSection />
          <SettingsSection
            anchor="system-cli"
            title="Command line"
            scope="device"
            description="Install the localix command to open projects and files from your terminal."
          >
            <SettingsRows>
              <ShellCommandRow />
            </SettingsRows>
          </SettingsSection>
          <StorageSection />
        </div>
      )}
    </SettingsPage>
  )
}
