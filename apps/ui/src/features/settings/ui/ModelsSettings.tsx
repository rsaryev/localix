import { TabBar } from '@localixai/kit/tabs'
import { LocalModelsSettings } from './LocalModelsSettings'
import { ModelCatalogSection } from './ModelCatalogSection'
import { SettingsPage } from './SettingsScaffold'

export type ModelsSettingsTab = 'models' | 'model-list'

/**
 * Settings → Models: the models agents run on, in one destination. Local finds, downloads and
 * removes models that run on this computer; Model list keeps the providers' models and prices
 * current. Which model a workload uses is chosen in the model picker.
 */
export function ModelsSettings({
  activeTab = 'models',
  onTabChange,
}: {
  activeTab?: ModelsSettingsTab
  onTabChange?: (tab: ModelsSettingsTab) => void
}) {
  return (
    <SettingsPage
      title="Models"
      description="Models that run on this computer, and the list of models providers offer. Which model each task uses is chosen in the model picker."
    >
      <TabBar
        aria-label="Model categories"
        items={[
          { id: 'models', label: 'Local' },
          { id: 'model-list', label: 'Model list' },
        ]}
        active={activeTab}
        onChange={(tab) => onTabChange?.(tab)}
      />
      {activeTab === 'model-list' ? <ModelCatalogSection /> : <LocalModelsSettings />}
    </SettingsPage>
  )
}
