import { useCallback, useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { acknowledgeInline, inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { shouldSurfaceStartupFailure, startStartupRetry } from '@/shared/lib/startupRetry'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import {
  SettingProblems,
  SettingRegistryList,
  SettingRegistryMeta,
  SettingRegistryRow,
} from './settingRegistry'
import { SettingsActionActivity } from './SettingsActionActivity'
import { SettingsSection } from './SettingsScaffold'

interface Marketplace {
  name: string
  builtin: boolean
  count: number
}

type MarketplaceMutation = { kind: 'add' } | { kind: 'remove'; name: string }

/**
 * Plugin marketplace catalog management. The built-in `localix` catalog is always
 * listed first and cannot be removed. Added marketplaces clone a CC-compatible
 * owner/repo catalog; plugins from them appear in `/plugin install` autocomplete.
 */
export function MarketplacesPanel({ onChanged }: { onChanged?: () => void }) {
  const workItemVisible = useWorkItemVisible()
  const [markets, setMarkets] = useState<Marketplace[] | null>(null)
  const [source, setSource] = useState('')
  const [mutation, setMutation] = useState<MarketplaceMutation | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  // `null` means "not loaded", `[]` means "loaded, and you have none" — the list below
  // relies on that distinction. Catching into `[]` FORGED the loaded signal, so a failed
  // request collapsed the list and left only the Add form: the built-in catalog looked
  // gone (reading as a broken install) and the user was invited to re-add a marketplace
  // that is already there. The error state this component already has — and already
  // renders for add/remove — was simply never fed by the load path.
  const load = useCallback(async (surfaceFailure = true): Promise<boolean> => {
    try {
      const rows = await backendClient.listMarketplaces()
      setMarkets(rows)
      setLoadError(null)
      return true
    } catch (e) {
      if (surfaceFailure) {
        acknowledgeInline(e)
        setLoadError('Could not load the marketplaces.')
      }
      return false
    }
  }, [])

  useEffect(() => {
    if (!workItemVisible) return
    return startStartupRetry((failureIndex) => load(shouldSurfaceStartupFailure(failureIndex)))
  }, [load, workItemVisible])

  const retryLoad = () => {
    setLoadError(null)
    void load()
  }

  const add = async () => {
    const src = source.trim()
    if (!src) return
    setMutation({ kind: 'add' })
    setMutationError(null)
    try {
      await backendClient.addMarketplace(src)
      setSource('')
      void load()
      onChanged?.()
    } catch (e) {
      setMutationError(inlineFailure(e, 'The marketplace request did not go through.'))
    } finally {
      setMutation(null)
    }
  }

  const remove = async (name: string) => {
    setMutation({ kind: 'remove', name })
    setMutationError(null)
    try {
      await backendClient.removeMarketplace(name)
      void load()
      onChanged?.()
    } catch (e) {
      setMutationError(inlineFailure(e, 'The marketplace request did not go through.'))
    } finally {
      setMutation(null)
    }
  }

  const adding = mutation?.kind === 'add'

  return (
    <SettingsSection
      title="Marketplaces"
      description="Shared catalogs used to discover and install plugins."
    >
      {markets === null && !loadError && <LoadingHint />}
      <SettingProblems
        className="mb-3"
        subject="Marketplaces"
        errors={loadError ? [loadError] : []}
        onRetry={retryLoad}
      />

      {markets !== null && markets.length > 0 && (
        <div className="mb-3">
          <SettingRegistryList>
            {markets.map((m) => (
              <SettingRegistryRow
                key={m.name}
                state="neutral"
                busyLabel={
                  mutation?.kind === 'remove' && mutation.name === m.name
                    ? `Removing ${m.name}`
                    : undefined
                }
                header={
                  <div className="min-w-0">
                    <code className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {m.name}
                    </code>
                    <SettingRegistryMeta
                      items={[
                        { label: `${m.count} plugin${m.count === 1 ? '' : 's'}` },
                        ...(m.builtin ? [{ label: 'built-in' }] : []),
                      ]}
                    />
                  </div>
                }
                actions={
                  !m.builtin ? (
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => void remove(m.name)}
                      disabled={mutation !== null}
                      className="text-text-soft hover:text-status-error"
                    >
                      Remove
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </SettingRegistryList>
        </div>
      )}

      {markets !== null && (
        <div className="flex flex-col items-stretch gap-3 @xl:flex-row @xl:items-end">
          <Field
            label="Marketplace source"
            description="GitHub owner/repo or a repository URL."
            className="min-w-0 flex-1"
          >
            <Input
              size="xl"
              className="font-mono text-xs"
              placeholder="owner/repo or https://github.com/…"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
              }}
            />
          </Field>
          <Button
            variant="mono"
            size="xl"
            onClick={() => void add()}
            disabled={mutation !== null || !source.trim()}
            aria-busy={adding || undefined}
            className="shrink-0 self-end"
          >
            {adding ? <SettingsActionActivity label="Adding" /> : 'Add'}
          </Button>
        </div>
      )}

      {mutationError && (
        <p role="alert" className="mt-2 text-xs text-status-error">
          {mutationError}
        </p>
      )}
    </SettingsSection>
  )
}
