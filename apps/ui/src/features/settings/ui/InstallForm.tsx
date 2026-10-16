import { Checkbox } from '@localixai/kit/checkbox'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { SettingsRecordEditor } from './SettingsRecordEditor'
import { INSTALL_SOURCE_ID, type InstallForm as InstallFormState } from '../model/useInstallForm'

/**
 * The "install from local path / git URL / owner+repo" dialog, shared by the
 * plugins panel. Renders nothing until the form is opened;
 * only the input placeholder and the enable-checkbox label differ between hosts.
 */
export function InstallForm({
  form,
  placeholder,
  enableLabel,
  subject,
  destination,
}: {
  form: InstallFormState
  placeholder: string
  enableLabel: string
  subject: string
  /**
   * Where this install lands, in words.
   *
   * The page no longer has a scope picker above every list — the lists show everything
   * visible from here — so the one remaining question a project answers, "where does a NEW
   * one go", is asked where it applies instead of being inferred from a filter.
   */
  destination?: string
}) {
  if (!form.installing) return null
  const source = form.source.trim()
  // The source is in the busy label because an install is the slow one on this screen and
  // the field it came from is behind the activity — "Installing plugin" alone does not say
  // which.
  const activityLabel = source ? `Installing ${subject} · ${source}` : `Installing ${subject}`

  return (
    <SettingsRecordEditor
      title={`Install ${subject}`}
      description={
        destination
          ? `Installs into ${destination}. Local paths are copied; remote sources are downloaded and validated first.`
          : 'Local paths are copied; remote sources are downloaded and validated first.'
      }
      busy={form.busy}
      busyLabel={activityLabel}
      submitLabel={`Install ${subject}`}
      error={form.error}
      onSubmit={() => void form.submit()}
      onCancel={form.close}
    >
      <Field
        controlId={INSTALL_SOURCE_ID}
        label="Source"
        description="Absolute local path, git URL, or owner/repo."
        required
        error={form.sourceError}
      >
        <Input
          size="xl"
          className="font-mono"
          placeholder={placeholder}
          value={form.source}
          onChange={(e) => form.setSource(e.target.value)}
          disabled={form.busy}
          autoFocus
        />
      </Field>
      <label className="flex items-center gap-2 text-xs text-text-soft">
        <Checkbox
          checked={form.installEnable}
          onChange={(e) => form.setInstallEnable(e.target.checked)}
          disabled={form.busy}
        />
        {enableLabel}
      </label>
    </SettingsRecordEditor>
  )
}
