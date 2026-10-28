/** General connection settings. URL import populates the same editable fields. */
import { AlertCircle, Check, Database, File, FolderOpen, Link2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { TextAction } from '@localixai/kit/text-action'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import type { ConnectFormState } from './useConnectForm'
import { focusOnMount } from '../focusOnMount'

function ConnectionField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  initialFocus,
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  /** Focus this field once, when it mounts. */
  initialFocus?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-2xs font-medium text-text-soft">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        ref={initialFocus ? focusOnMount : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </div>
  )
}

export function ConnectionInput({
  f,
  fid,
  onCancel,
}: {
  f: ConnectFormState
  fid: string
  onCancel?: () => void
}) {
  const changed = () => f.resetTest()
  const pickFile = async () => {
    const paths = await miniAppFiles.pickFiles()
    if (!paths[0]) return
    f.setFile(paths[0])
    changed()
  }

  return (
    <div className="space-y-4">
      <ConnectionField
        id={`${fid}-name`}
        label="Connection name"
        value={f.name}
        onChange={f.setName}
        placeholder={`My ${f.manifest.label}`}
      />

      {f.isFile ? (
        <>
          <div>
            <div className="mb-1.5 text-2xs font-medium text-text-soft">Storage</div>
            <SegmentedControl fullWidth aria-label={`${f.manifest.label} storage mode`}>
              <SegmentedControlItem
                active={f.targetMode === 'file'}
                onClick={() => f.setTargetMode('file')}
              >
                <File className="size-3" />
                Database file
              </SegmentedControlItem>
              <SegmentedControlItem
                active={f.targetMode === 'memory'}
                onClick={() => f.setTargetMode('memory')}
              >
                <Database className="size-3" />
                In-memory
              </SegmentedControlItem>
            </SegmentedControl>
          </div>

          {f.targetMode === 'memory' ? (
            <div className="border-y border-border-faint py-2.5">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <Database className="size-3.5 text-text-soft" />
                Temporary {f.manifest.label} database
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-text-faint">
                Created in memory and removed when this connection closes. No internal path needs to
                be entered.
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor={`${fid}-file`}
                className="mb-1 block text-2xs font-medium text-text-soft"
              >
                Database file
              </label>
              <div className="flex gap-2">
                <Input
                  id={`${fid}-file`}
                  value={f.file}
                  onChange={(event) => {
                    f.setFile(event.target.value)
                    changed()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void f.submit()
                    else if (event.key === 'Escape' && onCancel) onCancel()
                  }}
                  placeholder={f.manifest.databaseFieldPlaceholder}
                  ref={focusOnMount}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  variant="ghost"
                  onClick={() => void pickFile()}
                  className="shrink-0 text-text-soft"
                >
                  <FolderOpen data-icon="inline-start" aria-hidden className="size-3.5" />
                  Browse
                </Button>
              </div>
              <p className="mt-1 text-2xs text-text-faint">
                Select an existing file or enter a new absolute path.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="border-y border-border-faint py-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor={`${fid}-import-url`}
                className="flex items-center gap-1.5 text-2xs font-medium text-text-soft"
              >
                <Link2 className="size-3" />
                Import connection URL
              </label>
              {f.importUrl && (
                <TextAction
                  onClick={() => f.setImportUrl('')}
                  className="text-2xs text-text-faint hover:text-foreground"
                >
                  Clear
                </TextAction>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                id={`${fid}-import-url`}
                value={f.importUrl}
                onChange={(event) => f.setImportUrl(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData('text')
                  if (!pasted.trim()) return
                  event.preventDefault()
                  f.importConnectionUrl(pasted)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    f.importConnectionUrl()
                  }
                }}
                placeholder={f.manifest.connectionPlaceholder}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-invalid={!!f.importError}
                aria-describedby={`${fid}-import-${f.importError ? 'error' : 'help'}`}
                className={cn(f.urlImported && 'border-status-success/60')}
              />
              <Button
                variant="ghost"
                onClick={() => f.importConnectionUrl()}
                disabled={!f.importUrl.trim()}
                aria-live="polite"
                className={cn(
                  'w-20 shrink-0',
                  f.urlImported
                    ? 'border-status-success/50 text-status-success hover:bg-status-success/10 hover:text-status-success'
                    : 'text-text-soft',
                )}
              >
                {f.urlImported ? (
                  <Check data-icon="inline-start" aria-hidden className="size-3.5" />
                ) : (
                  <Link2 data-icon="inline-start" aria-hidden className="size-3.5" />
                )}
                {f.urlImported ? 'Imported' : 'Import'}
              </Button>
            </div>
            {f.importError ? (
              <p
                id={`${fid}-import-error`}
                role="alert"
                className="mt-1.5 flex items-center gap-1 text-2xs text-status-error"
              >
                <AlertCircle className="size-3 shrink-0" />
                {f.importError}
              </p>
            ) : (
              <p id={`${fid}-import-help`} className="mt-1.5 text-2xs text-text-faint">
                Pasting a URL fills the fields below; every value remains editable.
              </p>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <ConnectionField
              id={`${fid}-host`}
              label="Host"
              value={f.host}
              onChange={(value) => {
                f.setHost(value)
                changed()
              }}
              placeholder="localhost"
              initialFocus
            />
            <ConnectionField
              id={`${fid}-port`}
              label="Port"
              value={f.port}
              onChange={(value) => {
                f.setPort(value.replace(/[^0-9]/g, ''))
                changed()
              }}
              placeholder={f.manifest.defaultPort ? String(f.manifest.defaultPort) : 'Port'}
            />
          </div>

          <ConnectionField
            id={`${fid}-database`}
            label={f.manifest.databaseFieldLabel}
            value={f.database}
            onChange={(value) => {
              f.setDatabase(value)
              changed()
            }}
            placeholder={f.manifest.databaseFieldPlaceholder}
          />

          <div className="grid grid-cols-2 gap-2">
            <ConnectionField
              id={`${fid}-user`}
              label="User"
              value={f.user}
              onChange={(value) => {
                f.setUser(value)
                changed()
              }}
              placeholder="user"
            />
            <ConnectionField
              id={`${fid}-password`}
              label="Password"
              value={f.password}
              onChange={(value) => {
                f.setPassword(value)
                changed()
              }}
              placeholder="••••••••"
              type="password"
            />
          </div>
        </>
      )}
    </div>
  )
}
