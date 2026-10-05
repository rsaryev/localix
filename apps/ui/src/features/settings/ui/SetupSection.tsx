import { Button } from '@localixai/kit/button'
import { useNavigate } from 'react-router'
import { setupPath } from '@/shared/routing/routes'
import { SettingsControlRow, SettingsRows, SettingsSection } from './SettingsScaffold'

/** Existing model management and first-run setup remain the owners of their configuration. */
export function SetupSection() {
  const navigate = useNavigate()
  return (
    <SettingsSection
      title="Connections & setup"
      anchor="system-setup"
      description="Connect a provider in setup. Manage existing connections and workload routing from a conversation’s model picker."
    >
      <SettingsRows>
        <SettingsControlRow
          title="Run setup again"
          description="Revisit the first-run provider and default-model setup."
        >
          <Button
            variant="outline"
            size="xl"
            onClick={() => {
              void navigate(setupPath())
            }}
          >
            Replay setup
          </Button>
        </SettingsControlRow>
      </SettingsRows>
    </SettingsSection>
  )
}
