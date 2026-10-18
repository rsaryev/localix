import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { Button } from '@localixai/kit/button'
import { backendClient } from '@/shared/api/client'
import { SettingsRow, SettingsRows, SettingsSection } from './SettingsScaffold'
import { SettingsActionActivity } from './SettingsActionActivity'

/**
 * Settings → Models → Model list: an explicit check for new models and prices.
 *
 * The server checks on its own after startup and every hour, refetching a provider's list once it
 * is six hours old; this asks for every list now. A check that changes nothing, or one that fails,
 * leaves the current list in place, so the result line only reports what happened.
 */
export function ModelCatalogSection() {
  const { mutate } = useSWRConfig()
  const [checking, setChecking] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = async () => {
    setChecking(true)
    setError(null)
    try {
      const result = await backendClient.refreshModelCatalog()
      // The catalog route answers a revalidation with 304 when nothing changed.
      if (result.changed) await mutate('catalog')
      if (result.ok) setSummary('The model list is up to date.')
      else {
        setSummary(null)
        setError(
          `Some providers could not be checked and keep their current list${
            result.message ? `: ${result.message}` : '.'
          }`,
        )
      }
    } catch (failure) {
      setSummary(null)
      setError(failure instanceof Error ? failure.message : 'The check failed.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <SettingsSection
      anchor="model-list"
      title="Model list"
      description="New models and prices come from models.dev, OpenRouter, Vercel AI Gateway, and NVIDIA in the background, without an app update."
    >
      <SettingsRows>
        <SettingsRow layout="responsive">
          <div className="space-y-0.5">
            <p className="text-sm text-foreground">Providers and models</p>
            <p
              className="max-w-prose text-xs leading-5 text-text-soft text-pretty"
              aria-live="polite"
            >
              {summary ??
                'Checked after startup and every hour; a list is refetched once it is six hours old.'}
            </p>
            {error && (
              <p role="alert" className="text-xs leading-5 text-status-error">
                {error}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="xl"
              aria-busy={checking || undefined}
              disabled={checking}
              onClick={() => void check()}
            >
              {checking ? <SettingsActionActivity label="Checking" /> : 'Check for new models'}
            </Button>
          </div>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  )
}
