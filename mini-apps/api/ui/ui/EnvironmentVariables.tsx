import { KeyRound } from 'lucide-react'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import type { EnvVariable } from '../../backend/contracts'
import { PairEditor } from './PairEditor'

/** The open environment's rows, as a Variables view and a Vault-backed Secrets view. */
export function EnvironmentVariables({
  vars,
  variableTab,
  setVariableTab,
  visibleVars,
  setVisibleVars,
}: {
  vars: EnvVariable[]
  variableTab: 'variables' | 'secrets'
  setVariableTab: (tab: 'variables' | 'secrets') => void
  visibleVars: EnvVariable[]
  setVisibleVars: (next: EnvVariable[]) => void
}) {
  return (
    <>
      <WorkbenchToolbar aria-label="Environment variable controls" className="justify-between">
        <SegmentedControl aria-label="Environment variable type">
          <SegmentedControlItem
            active={variableTab === 'variables'}
            onClick={() => setVariableTab('variables')}
          >
            Variables · {vars.filter((variable) => !variable.secret).length}
          </SegmentedControlItem>
          <SegmentedControlItem
            active={variableTab === 'secrets'}
            onClick={() => setVariableTab('secrets')}
          >
            Secrets · {vars.filter((variable) => variable.secret).length}
          </SegmentedControlItem>
        </SegmentedControl>
        {variableTab === 'secrets' && (
          <span className="flex items-center gap-1.5 text-2xs text-text-faint">
            <KeyRound className="size-3.5" />
            Native Vault
          </span>
        )}
      </WorkbenchToolbar>
      <PairEditor
        key={variableTab}
        label={variableTab === 'secrets' ? 'Secrets' : 'Variables'}
        pairs={visibleVars}
        onChange={setVisibleVars}
        namePlaceholder={variableTab === 'secrets' ? 'api_token' : 'base_url'}
        valuePlaceholder={variableTab === 'secrets' ? 'Vault secret' : 'https://api.example.com'}
        secretValues={variableTab === 'secrets'}
      />
      {variableTab === 'secrets' && (
        <p className="px-3 pb-3 text-2xs text-text-faint">
          Type a new value to move it into Vault, or use the key button to reuse an existing secret.
          The literal never enters the environment file or browser history.
        </p>
      )}
    </>
  )
}
