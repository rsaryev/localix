import { useId, useMemo, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { findCatalogModel } from '@localixai/agent/catalog'
import { ModelPickerShell } from '@/features/chat/ui/prompt-input/model-select/ModelPickerShell'
import { useConnections } from '@/features/chat/ui/prompt-input/useConnections'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { IconButton } from '@localixai/kit/icon-button'
import { Select } from '@localixai/kit/select'
import { SettingsFieldGrid } from '../../SettingsFieldGrid'
import { AGENT_FIELD_IDS } from './agentDraft'
import { agentEffortOptions } from './agentEffortOptions'

interface AgentModelFieldProps {
  provider: string
  model: string
  effort: string
  disabled?: boolean
  effortError?: string
  onChange: (next: { provider: string; model: string }) => void
  onEffortChange: (effort: string) => void
}

/**
 * The agent's model, chosen in the SAME browser the chat composer and onboarding use.
 *
 * What it stores is a provider TYPE + model, never the connection that was clicked: a
 * definition file travels, connection ids do not, and one provider may have several. So the
 * pick maps `connectionId → providerId` here and forgets the connection. The task column is
 * off — a click on another workload row inside this form would rewrite live routing.
 */
export function AgentModelField({
  provider,
  model,
  effort,
  disabled,
  effortError,
  onChange,
  onEffortChange,
}: AgentModelFieldProps) {
  const { models } = useModelsCatalog()
  // The agent editor belongs to no chat: a provider connected from here routes none.
  const connectionsState = useConnections(null)
  const { connections } = connectionsState
  const [open, setOpen] = useState(false)
  const modelFieldId = useId()
  const modelHelpId = useId()

  const catalogModel = useMemo(
    () => findCatalogModel(models, provider || null, model || null),
    [models, provider, model],
  )
  // The browser's checkmark wants a connection; any live one of the pinned provider will do.
  const representativeConnection = useMemo(
    () => connections.find((connection) => connection.providerId === provider) ?? null,
    [connections, provider],
  )
  const connectionProvider = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection.providerId])),
    [connections],
  )

  const summary = model
    ? `${catalogModel?.providerName ?? provider ?? ''}${catalogModel || provider ? ' · ' : ''}${catalogModel?.name ?? model}`
    : 'Inherit the session model'
  const supportsReasoning = catalogModel?.supportsReasoning ?? Boolean(model)
  const effortOptions = useMemo(
    () => agentEffortOptions(catalogModel, effort),
    [catalogModel, effort],
  )

  return (
    <div className="min-w-0 space-y-2">
      <SettingsFieldGrid wideLeading columnsAt="2xl">
        <Field controlId={modelFieldId} label="Model" optional disabled={disabled}>
          <div className="flex min-w-0 items-center gap-2">
            <Button
              id={modelFieldId}
              variant="field"
              size="xl"
              className="min-w-0 flex-1 justify-between font-normal"
              aria-label={`Model: ${summary}`}
              aria-describedby={modelHelpId}
              aria-haspopup="dialog"
              aria-expanded={open}
              disabled={disabled}
              onClick={() => setOpen(true)}
            >
              <span className="min-w-0 truncate text-left">{summary}</span>
              <ChevronDown className="size-3.5 shrink-0 text-text-faint" />
            </Button>
            {model && (
              <IconButton
                size="xl"
                aria-label="Clear model — inherit the session model"
                tooltip="Inherit the session model"
                disabled={disabled}
                onClick={() => onChange({ provider: '', model: '' })}
              >
                <X />
              </IconButton>
            )}
          </div>
        </Field>

        <Field
          controlId={AGENT_FIELD_IDS.effort}
          label="Effort"
          optional
          error={effortError}
          disabled={disabled || !supportsReasoning}
        >
          <Select
            size="xl"
            className="w-full"
            value={effort}
            onValueChange={onEffortChange}
            options={effortOptions}
            disabled={disabled || !supportsReasoning}
            aria-label="Reasoning effort"
          />
        </Field>
      </SettingsFieldGrid>
      <p id={modelHelpId} className="text-xs leading-5 text-text-soft">
        {model && !provider
          ? 'A model id resolved against your available provider connections. External model aliases must be replaced with a catalog model.'
          : model
            ? 'Default for new chats after session choices and recent routes. Delegated work inherits the parent’s effective model and effort.'
            : 'Uses the session’s model routing. Delegated work inherits the parent’s effective model and effort.'}
      </p>

      <ModelPickerShell
        open={open}
        onOpenChange={setOpen}
        title="Choose the agent's model"
        models={models}
        connectionsState={connectionsState}
        taskColumn={false}
        initialProviderId={provider || undefined}
        sessionModelId={model}
        sessionConnectionId={representativeConnection?.id ?? null}
        onPickSessionModel={(connectionId, modelId) => {
          onChange({
            provider: connectionProvider.get(connectionId) ?? '',
            model: modelId,
          })
          setOpen(false)
        }}
      />
    </div>
  )
}
