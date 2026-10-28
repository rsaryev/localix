import { useId, useMemo, useState } from 'react'
import { ArrowLeft, Check, Plug, X } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { TabPanel, TabStrip, useTabPanelIds, type StripTabItem } from '@localixai/kit/tabs'
import type { DbConnectionInfo } from '../dbClient'
import { DIALECT_META } from '../model/dialects'
import { ConnectionInput } from './connect-form/ConnectionInput'
import { EnginePicker } from './connect-form/EnginePicker'
import { FormFooter } from './connect-form/FormFooter'
import type { ConnectFormEdit } from './connect-form/model'
import { OptionsSection } from './connect-form/OptionsSection'
import { SshSection } from './connect-form/SshSection'
import { TlsSection } from './connect-form/TlsSection'
import { useConnectForm } from './connect-form/useConnectForm'

export type { ConnectFormEdit }

type FormSection = 'general' | 'tls' | 'ssh' | 'options'
type ConnectStep = 'catalogue' | 'form'

/**
 * Reference-shaped connection flow:
 *  1. searchable database catalogue;
 *  2. driver identity + General/TLS/SSH/Options tabs;
 *  3. persistent Test/Connect footer.
 *
 * The compact rail variant uses the same state/assembly contract with a Select instead.
 */
export function ConnectForm({
  onConnected,
  edit,
  onCancel,
  variant = 'compact',
}: {
  onConnected: (connection: DbConnectionInfo) => void
  edit?: ConnectFormEdit
  onCancel?: () => void
  variant?: 'compact' | 'workspace'
}) {
  const fid = useId()
  const tabIds = useTabPanelIds('connection-settings')
  const f = useConnectForm(edit, onConnected)
  const [step, setStep] = useState<ConnectStep>(edit ? 'form' : 'catalogue')
  const [section, setSection] = useState<FormSection>('general')
  const sections = useMemo<StripTabItem<FormSection>[]>(() => {
    const items: StripTabItem<FormSection>[] = [{ id: 'general', label: 'General' }]
    if (f.manifest.capabilities.tls && f.isNetwork) items.push({ id: 'tls', label: 'TLS / SSL' })
    if (f.manifest.capabilities.sshTunnel) items.push({ id: 'ssh', label: 'SSH' })
    items.push({ id: 'options', label: 'Options' })
    return items.map((item) => ({
      ...item,
      ...tabIds.item(item.id),
    }))
  }, [f.isNetwork, f.manifest.capabilities.sshTunnel, f.manifest.capabilities.tls, tabIds])

  // A section that is no longer offered (the engine changed) falls back to General.
  if (!sections.some((item) => item.id === section)) setSection('general')

  if (variant === 'compact') {
    return (
      <div className="p-2.5">
        <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Plug className="size-3.5 text-text-soft" />
          {edit ? 'Edit connection' : 'Connect a database'}
        </div>
        <EnginePicker f={f} isEdit={!!edit} />
        <ConnectionInput f={f} fid={fid} onCancel={onCancel} />
        {f.manifest.capabilities.tls && f.isNetwork && <TlsSection f={f} fid={fid} />}
        <OptionsSection f={f} />
        {f.manifest.capabilities.sshTunnel && <SshSection f={f} fid={fid} />}
        <FormFooter f={f} isEdit={!!edit} onCancel={onCancel} />
      </div>
    )
  }

  const meta = DIALECT_META[f.dialect]
  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <PanelHeader
        tone="content"
        title={
          edit ? 'Edit connection' : step === 'catalogue' ? 'Choose a database' : 'New connection'
        }
        actions={
          <div className="flex items-center gap-2">
            {!edit && (
              <div className="hidden items-center gap-1.5 @lg:flex">
                <span
                  className={cn(
                    'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs',
                    step === 'catalogue' ? 'bg-surface-hover text-foreground' : 'text-text-soft',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 items-center justify-center rounded-full text-3xs font-semibold',
                      step === 'catalogue'
                        ? 'bg-foreground text-background'
                        : 'bg-status-success text-white',
                    )}
                  >
                    {step === 'catalogue' ? '1' : <Check className="size-2.5" />}
                  </span>
                  Choose
                </span>
                <span className="h-px w-3 bg-border" />
                <span
                  className={cn(
                    'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs',
                    step === 'form' ? 'bg-surface-hover text-foreground' : 'text-text-faint',
                  )}
                >
                  <span className="flex size-4 items-center justify-center rounded-full bg-surface-hover text-3xs font-semibold">
                    2
                  </span>
                  Configure
                </span>
              </div>
            )}
            {onCancel && (
              <IconButton
                size="sm"
                aria-label="Close connection editor"
                tooltip="Close"
                tooltipSide="bottom"
                onClick={onCancel}
              >
                <X className="size-3.5" />
              </IconButton>
            )}
          </div>
        }
      />

      {step === 'catalogue' && !edit ? (
        <EnginePicker f={f} isEdit={false} variant="workspace" onSelected={() => setStep('form')} />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-3 border-b border-border-soft px-4 py-2.5 @2xl:px-6">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center text-2xs font-semibold',
                meta.tintText,
              )}
            >
              {meta.badge}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xs font-semibold text-foreground">{f.manifest.label}</h1>
              <p className="mt-0.5 truncate text-2xs text-text-faint">{f.manifest.description}</p>
            </div>
            {!edit && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setSection('general')
                  setStep('catalogue')
                }}
                className="ml-auto text-text-soft"
              >
                <ArrowLeft className="size-3" />
                Change database
              </Button>
            )}
          </div>

          <div className="shrink-0 border-b border-border-soft px-4 @2xl:px-6">
            <TabStrip
              items={sections}
              activeId={section}
              onChange={setSection}
              variant="underline"
              aria-label="Connection settings"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {sections.map((item) => (
              <TabPanel
                key={item.id}
                id={tabIds.panelId(item.id)}
                aria-labelledby={tabIds.tabId(item.id)}
                active={section === item.id}
                className="w-full px-4 py-4 @2xl:px-6"
              >
                {item.id === 'general' ? (
                  <ConnectionInput f={f} fid={fid} onCancel={onCancel} />
                ) : item.id === 'tls' ? (
                  <TlsSection f={f} fid={fid} />
                ) : item.id === 'ssh' ? (
                  <SshSection f={f} fid={fid} />
                ) : (
                  <OptionsSection f={f} expanded />
                )}
              </TabPanel>
            ))}
          </div>

          {/* No ground coat: the hosting pane already paints `--background`, and under the macOS
              glass theme that token carries alpha — a second coat on the footer compounded into
              a darker band than the form above it. The border-t is the whole seam. */}
          <div className="shrink-0 border-t border-border-soft px-4 py-2.5 @2xl:px-6">
            <FormFooter f={f} isEdit={!!edit} onCancel={onCancel} variant="workspace" />
          </div>
        </>
      )}
    </div>
  )
}
