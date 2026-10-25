import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import { SwitchRow } from './SwitchRow'
import { SettingsRows, SettingsSection } from './SettingsScaffold'

/**
 * `research` is deliberately keyless. The only network knob is the explicit
 * opt-in that lifts its SSRF guard for a user's own local/private resources.
 */
export function ResearchSection() {
  const { settings, update } = useUserSettings()

  return (
    <SettingsSection
      title="Research access"
      anchor="system-research"
      scope="workspace"
      description="Choose whether research may read local development servers and private network sources. Applies to every agent."
    >
      <SettingsRows>
        <SwitchRow
          title="Allow private and local URLs"
          description={
            <>
              By default <code>research</code> refuses any address that resolves to localhost, a
              private network, or a link-local host — including after a redirect — so a public page
              cannot bounce the agent into your internal network. Turn this on to let the agent read
              your own dev server or a LAN host.
            </>
          }
          checked={settings.agentSettings?.research?.allowPrivate ?? false}
          onChange={() =>
            update({
              agentSettings: {
                ...useUserSettings.getState().settings.agentSettings,
                research: {
                  allowPrivate: !(
                    useUserSettings.getState().settings.agentSettings?.research?.allowPrivate ??
                    false
                  ),
                },
              },
            })
          }
          label="Allow research to reach private and local addresses"
        />
      </SettingsRows>
    </SettingsSection>
  )
}
