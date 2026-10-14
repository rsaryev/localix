import { useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, KeyRound, LogIn, Plus, X } from 'lucide-react'
import type { ProviderEntry } from '@localixai/agent/catalog'
import { toast } from '@/shared/lib/notify'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { LabelDivider } from '@localixai/kit/label-divider'
import { PanelHeader } from '@localixai/kit/panel-header'
import { SectionLabel } from '@localixai/kit/section-label'
import { Spinner } from '@localixai/kit/spinner'
import { useCopied } from '@localixai/plugin-sdk/ui/interactions'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { PickerPanelTitle } from './PickerPanelTitle'

interface AddConnectionFormProps {
  /** The narrow layout's workload/provider switcher; it takes the title's place below md. */
  nav?: ReactNode
  provider: ProviderEntry
  /** Whether this provider supports an OAuth login flow (from the server OAuth registry). */
  isOAuth?: boolean
  /** OAuth button label (e.g. "Subscription (Claude Pro/Max)"). */
  oauthLabel?: string
  /** One-line explanation of what the OAuth login uses / how it's billed. */
  oauthDescription?: string
  onAdded: () => void
  onAddApiKey: (label: string, apiKey: string, opts?: { extraKeys?: string[] }) => void
  onAddOAuth: (
    label: string,
  ) => void | Promise<void | { mode: string; userCode?: string; verificationUri?: string }>
}

/** Stable row identity for the key inputs — index keys would reassign a row's DOM
 *  node (and its focus) to the wrong value when a middle row is removed. */
let nextKeyRowId = 0
const emptyKeyRow = () => ({ id: `key-${nextKeyRowId++}`, value: '' })

interface DeviceInfo {
  userCode?: string
  verificationUri?: string
}

export function DeviceAuthorizationStatus({
  deviceInfo,
  copied,
  onCopy,
}: {
  deviceInfo: DeviceInfo
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="mt-2 flex flex-col gap-2 border-y border-border-faint py-3">
      <span className="text-2xs leading-snug text-text-soft">
        1. Open{' '}
        {deviceInfo.verificationUri ? (
          <ExternalAnchor
            href={deviceInfo.verificationUri}
            systemBrowser
            className="text-foreground underline underline-offset-2"
          >
            {deviceInfo.verificationUri}
          </ExternalAnchor>
        ) : (
          'the provider verification page'
        )}{' '}
        and enter this code:
      </span>
      <div className="flex items-center gap-2">
        {/* Foreground veil, not `bg-background`: that is the WINDOW ground — denser than the
            popover this form lives in, so the device code read as a black plate on it. */}
        <span className="select-all rounded-md border border-border-soft bg-foreground/[0.06] px-3 py-1.5 font-mono text-base tracking-[0.3em] text-foreground">
          {deviceInfo.userCode}
        </span>
        <Button variant="outline" size="lg" onClick={onCopy}>
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <span className="inline-flex items-center gap-1.5 text-2xs leading-snug text-text-soft">
        <ActivityOrb className="size-3 text-status-info" />
        Waiting for authorization. The connection appears here automatically once approved.
      </span>
    </div>
  )
}

export function AddConnectionForm({
  nav,
  provider,
  isOAuth = false,
  oauthLabel,
  oauthDescription,
  onAdded,
  onAddApiKey,
  onAddOAuth,
}: AddConnectionFormProps) {
  const [label, setLabel] = useState('')
  const [keys, setKeys] = useState<{ id: string; value: string }[]>(() => [emptyKeyRow()])
  const [busy, setBusy] = useState(false)
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const { copied, copy } = useCopied()

  const trimmedKeys = keys.map((k) => k.value.trim()).filter(Boolean)

  const handleApiKey = (e: React.FormEvent) => {
    e.preventDefault()
    if (trimmedKeys.length === 0) return
    const [first, ...rest] = trimmedKeys
    onAddApiKey(label.trim(), first, { extraKeys: rest })
    onAdded()
    setLabel('')
    setKeys([emptyKeyRow()])
  }

  const updateKey = (id: string, value: string) =>
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, value } : k)))
  const addKeyRow = () => setKeys((prev) => [...prev, emptyKeyRow()])
  const removeKeyRow = (id: string) =>
    setKeys((prev) => (prev.length <= 1 ? prev : prev.filter((k) => k.id !== id)))

  const handleOAuth = async () => {
    setBusy(true)
    try {
      const res = await onAddOAuth(label.trim())
      if (res && res.mode === 'cancelled') return
      // Device-code flow (GitHub Copilot): keep the form open and show the code to enter.
      if (res && res.mode === 'device-code' && res.userCode) {
        setDeviceInfo({ userCode: res.userCode, verificationUri: res.verificationUri })
        return
      }
      onAdded()
      setLabel('')
    } catch (error) {
      toast.error('Could not complete the sign-in', {
        description: errorMessage(error, '') || undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PanelHeader
        tone="content"
        title={<PickerPanelTitle title={provider.name} nav={nav} />}
        summary={
          <span className="flex shrink-0 items-center gap-1 text-2xs text-text-faint">
            {isOAuth ? (
              <LogIn className="size-3" aria-hidden="true" />
            ) : (
              <KeyRound className="size-3" aria-hidden="true" />
            )}
            {isOAuth ? 'OAuth' : 'API key'}
          </span>
        }
        actionsLabel={`${provider.name} connection actions`}
        actions={
          provider.doc ? (
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              aria-label={`Open ${provider.name} documentation`}
              title="Provider documentation"
            >
              <ExternalAnchor href={provider.doc}>
                <ExternalLink />
              </ExternalAnchor>
            </Button>
          ) : undefined
        }
      />

      {/* The body sits on the header's gutter, so a field's edge lines up with the title. */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-(--workbench-gutter) py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <SectionLabel as="span" weight="semibold">
              Connection Label
            </SectionLabel>
            <Input
              type="text"
              size="lg"
              placeholder="Label (e.g. My OpenAI, Work, Personal)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {isOAuth && (
            <div className="flex flex-col gap-1 mt-1">
              <SectionLabel as="span" weight="semibold">
                Authentication
              </SectionLabel>
              <Button
                type="button"
                variant="mono"
                size="lg"
                disabled={busy}
                onClick={() => {
                  void handleOAuth()
                }}
                className="w-full rounded-lg px-4 font-semibold"
              >
                {busy ? (
                  <>
                    <Spinner className="size-3.5" />
                    Connecting
                  </>
                ) : (
                  (oauthLabel ?? 'Connect via OAuth')
                )}
              </Button>
              {oauthDescription && !deviceInfo && (
                <span className="text-2xs text-text-soft leading-snug mt-0.5">
                  {oauthDescription}
                </span>
              )}
              {deviceInfo && (
                <DeviceAuthorizationStatus
                  deviceInfo={deviceInfo}
                  copied={copied}
                  onCopy={() => {
                    if (deviceInfo.userCode) void copy(deviceInfo.userCode)
                  }}
                />
              )}
            </div>
          )}

          {/* Divider when both OAuth and manual key are offered */}
          {isOAuth && <LabelDivider role="presentation">or</LabelDivider>}

          <form onSubmit={handleApiKey} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <SectionLabel as="span" weight="semibold">
                {isOAuth ? 'API Key(s) (manual)' : 'API Key(s)'}
              </SectionLabel>
              {keys.map((key, index) => (
                <div key={key.id} className="flex items-center gap-1.5">
                  <Input
                    type="password"
                    size="lg"
                    placeholder={index === 0 ? 'Enter API key' : `Additional key ${index + 1}`}
                    value={key.value}
                    onChange={(e) => updateKey(key.id, e.target.value)}
                    className="flex-1"
                  />
                  {keys.length > 1 && (
                    <IconButton
                      size="md"
                      tone="danger"
                      onClick={() => removeKeyRow(key.id)}
                      aria-label={`Remove API key ${index + 1}`}
                      tooltip="Remove key"
                    >
                      <X />
                    </IconButton>
                  )}
                </div>
              ))}
              <Button
                variant="ghost"
                size="xs"
                onClick={addKeyRow}
                className="self-start text-text-soft"
              >
                <Plus data-icon="inline-start" /> Add another key
              </Button>
            </div>

            <Button
              type="submit"
              variant="mono"
              size="lg"
              disabled={trimmedKeys.length === 0}
              className="w-full rounded-lg px-4 font-semibold"
            >
              Add Connection
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
