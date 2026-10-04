import { useUserSettings } from '../../model/useUserSettings'
import { SwitchRow } from '../SwitchRow'
import { SettingsRows, SettingsSection } from '../SettingsScaffold'

/**
 * `research` is deliberately keyless. The only network knob is the explicit
 * opt-in that lifts its SSRF guard for a user's own local/private resources.
 */
export function ResearchSection() {
  const { settings, update } = useUserSettings()

  return (
    <SettingsSection
      title="Research"
      description="Tokenless metasearch and safe source reading across web, academic, code, community, and encyclopedia sources. Partial provider failures degrade gracefully."
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
                ...settings.agentSettings,
                research: {
                  allowPrivate: !(settings.agentSettings?.research?.allowPrivate ?? false),
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
