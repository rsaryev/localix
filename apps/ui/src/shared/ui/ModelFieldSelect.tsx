import { forwardRef, useMemo } from 'react'
import useSWR from 'swr'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import { Sparkles } from 'lucide-react'
import { backendClient } from '@/shared/api/client'
import { useModelsCatalog, type CatalogModel } from '@/shared/hooks/useModelsCatalog'
import { Combobox, type ComboboxOption, type ComboboxProps } from '@localixai/kit/combobox'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/**
 * Provider+model picker for configuration fields. It reads the same catalog as
 * the chat composer without mutating the session's active connection.
 *
 * The field delegates interaction, geometry, focus and popup semantics to the
 * shared searchable Combobox. This component owns only model-domain mapping:
 * connected-provider groups, context metadata, inheritance, and stale values.
 */

const MODEL_FIELD_DEFAULT_LABEL = 'Default — session model'

interface ModelFieldSelectProps extends Pick<
  ComboboxProps,
  'id' | 'disabled' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid'
> {
  /** Catalog model id, or '' for "Default — session model". */
  value: string
  onValueChange: (id: string) => void
  className?: string
}

interface ModelFieldGroup {
  providerId: string
  providerName: string
  models: CatalogModel[]
}

export function buildModelFieldOptions(
  groups: readonly ModelFieldGroup[],
  value: string,
): readonly ComboboxOption[] {
  const next: ComboboxOption[] = [
    {
      value: '',
      label: MODEL_FIELD_DEFAULT_LABEL,
      icon: <Sparkles aria-hidden="true" className="size-3.5" />,
    },
  ]
  const hasCurrent = groups.some((group) => group.models.some((model) => model.id === value))

  // A saved id may outlive its provider connection or catalog entry. Keep it visible and
  // clearable instead of silently presenting a different model as the current value.
  if (value && !hasCurrent) {
    next.push({
      value,
      label: value,
      group: 'Current (provider not connected)',
      hint: 'saved',
    })
  }

  for (const group of groups) {
    for (const model of group.models) {
      next.push({
        value: model.id,
        label: model.name,
        group: group.providerName,
        description: model.contextLength
          ? `${Math.round(model.contextLength / 1000)}k context`
          : undefined,
      })
    }
  }
  return next
}

export const ModelFieldSelect = forwardRef<HTMLButtonElement, ModelFieldSelectProps>(
  function ModelFieldSelect({ value, onValueChange, className, ...triggerProps }, ref) {
    const { models, providers, isLoading: catalogLoading } = useModelsCatalog()
    // Connections are read-only here: choosing a config value must never switch the chat session.
    // The 'providers' topic keeps this read current when a connection changes elsewhere.
    useRevalidateOnResources('provider-connections', ['providers'])
    const { data: connections, isLoading: connectionsLoading } = useSWR(
      'provider-connections',
      () => backendClient.listConnections(),
      {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      },
    )

    const groups = useMemo(() => {
      const connectedIds = new Set<string>()
      for (const connection of connections ?? []) {
        if (connection.hasApiKey) connectedIds.add(connection.providerId)
      }

      const byProvider = new Map<string, CatalogModel[]>()
      for (const model of models) {
        if (!model.providerId || !connectedIds.has(model.providerId)) continue
        const list = byProvider.get(model.providerId)
        if (list) list.push(model)
        else byProvider.set(model.providerId, [model])
      }

      // Preserve catalog/provider order: enabled drop-in providers intentionally lead here.
      const providerMeta = new Map(
        providers.map((provider, index) => [provider.id, { name: provider.name, order: index }]),
      )
      return [...byProvider.entries()]
        .map(([providerId, providerModels]) => ({
          providerId,
          providerName: providerMeta.get(providerId)?.name ?? providerId,
          models: providerModels,
        }))
        .sort(
          (a, b) =>
            (providerMeta.get(a.providerId)?.order ?? Infinity) -
            (providerMeta.get(b.providerId)?.order ?? Infinity),
        )
    }, [models, providers, connections])

    const options = useMemo(() => buildModelFieldOptions(groups, value), [groups, value])

    return (
      <Combobox
        ref={ref}
        modal
        size="xl"
        className={cn('w-full text-left', className)}
        contentClassName="w-[min(20rem,calc(100vw-2rem))]"
        value={value}
        onValueChange={onValueChange}
        options={options}
        {...triggerProps}
        searchPlaceholder="Search models…"
        menuHeader={
          !catalogLoading && !connectionsLoading && groups.length === 0
            ? 'No connected providers — connect one in the chat model picker.'
            : undefined
        }
        emptyLabel={catalogLoading || connectionsLoading ? 'Loading models…' : 'No models found'}
      />
    )
  },
)
