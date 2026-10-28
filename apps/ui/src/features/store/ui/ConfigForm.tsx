import { useState, type KeyboardEvent } from 'react'
import type { ConfigValue, ListingConfig } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { Field } from '@localixai/kit/field'
import { isPrimaryModifier } from '@/shared/lib/keybindings'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import {
  changedKeys,
  changesToSave,
  draftProblems,
  openingDraft,
  type ConfigDraft,
  type DraftValue,
} from '../model/configDraft'
import { ConfigControl } from './ConfigFields'

/** Labels and help on the left, the control on the right, once the form is wide enough. */
const ROW =
  '@xl/config:grid @xl/config:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @xl/config:gap-x-8 @xl/config:gap-y-1 ' +
  '@xl/config:[&>[data-slot=field-label]]:col-start-1 @xl/config:[&>[data-slot=field-description]]:col-start-1 ' +
  '@xl/config:[&>:not([data-slot^=field-])]:col-start-2 @xl/config:[&>:not([data-slot^=field-])]:row-span-2 @xl/config:[&>:not([data-slot^=field-])]:row-start-1 ' +
  '@xl/config:[&>[data-slot=field-error]]:col-start-2 @xl/config:[&>[data-slot=field-error]]:row-start-3'

/**
 * THE ONE CONFIGURATION FORM (`docs/internals/store.md`, "Configuration"): every package's
 * settings, whatever its kind, are fields a provider declares and this renders. Saving is
 * explicit — Save, Revert and Cmd+S, with the unsaved state said — because a setting reaches
 * running code (a server restarts, a plugin reloads) and a secret or a half-typed address must
 * not take effect while it is being typed. It sends only what changed, and one failure is said
 * beside the buttons while the edits stay.
 */
export function ConfigForm({
  config,
  onSave,
  submitLabel,
}: {
  config: ListingConfig
  onSave: (values: Record<string, ConfigValue>) => Promise<void>
  /** Making a new item: its button, always ready; there is nothing saved to revert to. */
  submitLabel?: string
}) {
  // Only what was edited: the rest follows the saved values, so a save that comes back with new
  // ones needs no resetting. `revision` remounts the controls that keep their own typed text.
  const [edits, setEdits] = useState<ConfigDraft>({})
  const [revision, setRevision] = useState(0)
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const draft: ConfigDraft = { ...openingDraft(config), ...edits }
  const dirty = changedKeys(config, draft).length > 0
  const problems = shown ? draftProblems(config, draft) : {}

  const save = async () => {
    if (busy || (!dirty && !submitLabel)) return
    if (Object.keys(draftProblems(config, draft)).length > 0) return setShown(true)
    setBusy(true)
    setFailure(null)
    try {
      await onSave(changesToSave(config, draft))
      setEdits({})
      setRevision((current) => current + 1)
      setShown(false)
    } catch (error) {
      setFailure(errorMessage(error, 'The settings could not be saved'))
    } finally {
      setBusy(false)
    }
  }
  const revert = () => {
    setEdits({})
    setRevision((current) => current + 1)
    setShown(false)
    setFailure(null)
  }
  const keys = (event: KeyboardEvent) => {
    if (isPrimaryModifier(event) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
    }
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- delegated Mod+S: the keydown comes from the fields inside, the form is never the target
    <form
      // The form says what is wrong at the field; the browser's own bubble would say it twice.
      noValidate
      className="@container/config flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      onKeyDown={keys}
    >
      <div className={DIVIDED_LIST}>
        {config.fields.map((field) => (
          <Field
            key={`${field.key}:${revision}`}
            className={`py-3 ${ROW}`}
            label={field.label}
            description={field.help}
            error={problems[field.key]}
            required={field.required}
            layout="stacked"
          >
            <ConfigControl
              field={field}
              value={draft[field.key]!}
              held={config.set.includes(field.key)}
              onChange={(value: DraftValue) =>
                setEdits((current) => ({ ...current, [field.key]: value }))
              }
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {failure ? (
          <p role="alert" className="mr-auto text-xs text-status-error">
            {failure}
          </p>
        ) : (
          <p role="status" className="mr-auto text-xs text-text-soft">
            {dirty && !submitLabel ? 'Unsaved changes' : ''}
          </p>
        )}
        {!submitLabel && (
          <Button variant="ghost" size="lg" disabled={!dirty || busy} onClick={revert}>
            Revert
          </Button>
        )}
        <Button
          variant="mono"
          size="lg"
          type="submit"
          disabled={(!dirty && !submitLabel) || busy}
          aria-busy={busy}
        >
          {submitLabel ?? 'Save'}
        </Button>
      </div>
    </form>
  )
}
