import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { toast } from '@/shared/lib/notify'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { SectionLabel } from '@localixai/kit/section-label'
import { Spinner } from '@localixai/kit/spinner'
import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import type { EnvDetectedProvider } from '@/shared/api/contracts'
import { useConnections } from './useConnections'

interface EnvDetectedProvidersProps {
  /** The chat a new connection is routed to — `null` from a surface that has none (onboarding). */
  sessionId: string | null
  /** Section heading; pass null for no heading. */
  title?: string | null
  /** Called after a successful connect — e.g. to advance a wizard. */
  onConnected?: (providerId: string) => void
}

export function EnvDetectedProviderRow({
  provider,
  disabled,
  isConnecting,
  onConnect,
}: {
  provider: EnvDetectedProvider
  disabled?: boolean
  isConnecting?: boolean
  onConnect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onConnect}
      className="group flex min-h-11 w-full items-center justify-between gap-3 px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-surface-hover focus-ring disabled:opacity-50"
    >
      <span className="flex min-w-0 items-center gap-2">
        <KeyRound className="size-3.5 shrink-0 text-status-success" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {provider.providerName}
          </span>
          <span className="block truncate font-mono text-2xs text-text-faint">
            {provider.envVar}
          </span>
        </span>
      </span>
      {isConnecting ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-2xs text-text-soft">
          <Spinner size="xs" />
          Connecting
        </span>
      ) : (
        <span className="shrink-0 text-2xs font-medium text-status-success">Connect</span>
      )}
    </button>
  )
}

/**
 * "Detected in your environment" — one-click connect for any provider whose API
 * key the SERVER found in its environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, …).
 * Presence-only: the key value never reaches the client; `connectFromEnv` reads
 * it server-side. Renders NOTHING when no key is detected. Reused by the
 * onboarding Provider step and the empty-chat connect prompt. Re-fetches when
 * the connection set changes (a connect removes its row from the list).
 */
export function EnvDetectedProviders({
  sessionId,
  title = 'Detected in your environment',
  onConnected,
}: EnvDetectedProvidersProps) {
  const { connections, connectFromEnv } = useConnections(sessionId)
  const [detected, setDetected] = useState<EnvDetectedProvider[]>([])
  const [connecting, setConnecting] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    backendClient
      .listEnvDetectedProviders()
      .then((p) => {
        if (alive) setDetected(p)
      })
      .catch(() => {
        if (alive) setDetected([])
      })
    return () => {
      alive = false
    }
  }, [connections.length])

  if (detected.length === 0) return null

  const connect = async (providerId: string) => {
    setConnecting(providerId)
    try {
      await connectFromEnv(providerId)
      onConnected?.(providerId)
    } catch (e) {
      const name = detected.find((p) => p.providerId === providerId)?.providerName ?? providerId
      toast.error(`Could not connect ${name} from your environment`, {
        description: errorMessage(e, '') || undefined,
      })
    } finally {
      setConnecting(null)
    }
  }

  return (
    <div className="w-full space-y-1.5 text-left">
      {title && (
        <SectionLabel as="span" weight="semibold">
          {title}
        </SectionLabel>
      )}
      <div className={DIVIDED_LIST}>
        {detected.map((provider) => (
          <EnvDetectedProviderRow
            key={provider.providerId}
            provider={provider}
            disabled={connecting !== null}
            isConnecting={connecting === provider.providerId}
            onConnect={() => void connect(provider.providerId)}
          />
        ))}
      </div>
    </div>
  )
}
