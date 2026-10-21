import { useEffect, useId, useState } from 'react'
import { Pencil, RefreshCw, TriangleAlert } from 'lucide-react'

import { VAULT_ITEM_TYPE_DEFINITIONS, VAULT_ITEM_TYPES } from '@localixai/api/vault-item-types'
import type { SecretMeta, VaultItemType } from '@localixai/api/client'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { errorDetail } from '@/shared/api/internal'
import { secretsApi } from '@/shared/api/secretsApi'
import { Button } from '@localixai/kit/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Field } from '@localixai/kit/field'
import { focusFirstInvalid, type FieldErrors } from '@/shared/lib/forms/fieldErrors'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import type { SelectOption } from '@localixai/kit/select'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'
import { SECRET_KEY_MAX_LENGTH } from '@/features/secrets/model/secretDraft'
import { VAULT_PROBLEM_SCOPE } from '../model/vaultProblem'
import { VAULT_TYPE_PRESENTATION } from '../model/vaultTypePresentation'
import {
  vaultDraftReady,
  vaultKeyProblem,
  vaultMissingFields,
  vaultValueProblem,
  type VaultField,
} from '../model/vaultDraftErrors'

const GROUP_LABELS = {
  developer: 'Developer',
  access: 'Access',
  finance: 'Finance',
  identity: 'Identity',
  personal: 'Personal',
} as const

const TYPE_OPTIONS: SelectOption[] = VAULT_ITEM_TYPES.map((value) => {
  const definition = VAULT_ITEM_TYPE_DEFINITIONS[value]
  return {
    value,
    label: `${GROUP_LABELS[definition.group]} · ${definition.label}`,
    icon: VAULT_TYPE_PRESENTATION[value].Icon,
  }
})

interface VaultItemDialogProps {
  open: boolean
  mode: 'create' | 'edit' | 'rotate'
  item?: SecretMeta
  onOpenChange: (open: boolean) => void
  onSaved: (item: SecretMeta) => void
}

export function VaultItemDialogBody({
  open,
  mode,
  item,
  onOpenChange,
  onSaved,
}: VaultItemDialogProps) {
  const keyId = useId()
  const valueId = useId()
  const titleId = useId()
  const descriptionId = useId()
  const [key, setKey] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<VaultItemType>('secret')
  const [tags, setTags] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  /**
   * What SUBMITTING found missing, layered over the live checks below.
   *
   * The live ones deliberately say nothing about an empty field — untouched is not wrong,
   * just not ready — which is right while typing and useless at the moment of the click. The
   * button used to carry that difference by greying itself out, so an empty alias produced a
   * dead control and no sentence. See `shared/lib/forms/fieldErrors.ts`.
   */
  const [missing, setMissing] = useState<FieldErrors<VaultField>>({})
  const [error, setError] = useState<Problem | null>(null)
  const problem = useProblemReport(
    error ? { subject: { label: item?.label ?? 'Vault item' }, problems: [error] } : null,
    { scope: VAULT_PROBLEM_SCOPE, sourceVisible: true },
  )

  useEffect(() => {
    if (!open) return
    setKey(mode === 'create' ? '' : (item?.key ?? ''))
    setTitle(mode === 'create' ? '' : (item?.label ?? ''))
    setDescription(mode === 'create' ? '' : (item?.description ?? ''))
    setType(mode === 'create' ? 'secret' : (item?.type ?? 'secret'))
    setTags(mode === 'create' ? '' : (item?.tags.join(', ') ?? ''))
    setValue('')
    setMissing({})
    setError(null)
    setBusy(false)
  }, [item, mode, open])

  // Live problem first — malformed is more specific than "Required." — then what the last
  // submit found missing. Both from `model/vaultDraftErrors.ts`, which owns the rules.
  const draft = { key, value, title }
  const keyProblem = vaultKeyProblem(mode, key, missing)
  const valueProblem = vaultValueProblem(mode, value, missing)
  const normalizedTags = tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  const typeDefinition = VAULT_ITEM_TYPE_DEFINITIONS[type]
  const TypeIcon = VAULT_TYPE_PRESENTATION[type].Icon
  /** Edit a field and stop reporting it as missing. */
  const edited = (field: VaultField) =>
    setMissing((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))

  const submit = async () => {
    if (busy) return
    if (!vaultDraftReady(mode, draft)) {
      // Say WHICH field, and take the reader to it.
      const found = vaultMissingFields(mode, draft)
      setMissing(found)
      focusFirstInvalid(found, { key: keyId, value: valueId, title: titleId })
      return
    }
    setMissing({})
    const submittedValue = value
    // Keep plaintext out of component state while the request is in flight.
    setValue('')
    setBusy(true)
    setError(null)
    try {
      const saved =
        mode === 'create'
          ? await secretsApi.create({
              key,
              value: submittedValue,
              label: title.trim() || undefined,
              description: description.trim() || undefined,
              type,
              tags: normalizedTags,
            })
          : mode === 'edit'
            ? await secretsApi.updateMetadata(item!.key, {
                expectedVersion: item!.version,
                title: title.trim(),
                description: description.trim(),
                type,
                tags: normalizedTags,
              })
            : await secretsApi.rotate(item!.key, {
                value: submittedValue,
                expectedVersion: item!.version,
              })
      onSaved(saved)
      onOpenChange(false)
    } catch (caught) {
      setError({
        message: errorMessage(caught, 'This Vault item could not be saved.'),
        detail: errorDetail(caught),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {mode === 'create' ? (
            <TypeIcon aria-hidden="true" className="size-4 text-text-soft" strokeWidth={1.75} />
          ) : mode === 'edit' ? (
            <Pencil className="size-4 text-text-soft" />
          ) : (
            <RefreshCw className="size-4 text-text-soft" />
          )}
          {mode === 'create'
            ? 'Add Vault item'
            : mode === 'edit'
              ? `Edit ${item?.label ?? 'item'}`
              : `Rotate ${item?.label ?? 'credential'}`}
        </DialogTitle>
        <DialogDescription>
          {mode === 'create'
            ? 'The value is encrypted immediately and will never be returned by the API.'
            : mode === 'edit'
              ? 'Update value-free metadata. The encrypted value remains unchanged and hidden.'
              : 'A new immutable version is created. Existing references keep working.'}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="grid gap-3">
        {mode !== 'rotate' && (
          <>
            <Field controlId={titleId} label="Title">
              <Input
                size="lg"
                value={title}
                maxLength={120}
                placeholder="Production database"
                onChange={(event) => {
                  edited('title')
                  setTitle(event.target.value)
                }}
              />
            </Field>

            <Field label="Type">
              <Select
                value={type}
                options={TYPE_OPTIONS}
                onValueChange={(next) => setType(next as VaultItemType)}
                aria-label="Vault item type"
              />
            </Field>

            {/* `Field` owns the label/hint/error identity and the aria wiring that used to be
                spelled out by hand here — the same three ids, derived once. */}
            {mode === 'create' && (
              <Field
                controlId={keyId}
                label="Alias"
                description={
                  <>
                    Stable reference: <code>secret:ALIAS</code>
                  </>
                }
                error={keyProblem}
              >
                <Input
                  size="lg"
                  value={key}
                  maxLength={SECRET_KEY_MAX_LENGTH}
                  spellCheck={false}
                  autoCapitalize="off"
                  placeholder="PROD_DB_PASSWORD"
                  onChange={(event) => {
                    edited('key')
                    setKey(event.target.value)
                  }}
                />
              </Field>
            )}
          </>
        )}

        {typeDefinition.highImpact && (
          <div className="flex items-start gap-2 border-y border-status-warning/25 py-2 text-xs/relaxed text-text-soft">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-status-warning"
            />
            <span>
              High-impact item. Localix encrypts it at rest and never exposes it through the agent
              API, but device compromise can still defeat a local software vault. Keep independent
              recovery and prefer hardware custody where appropriate.
            </span>
          </div>
        )}

        {mode !== 'edit' && (
          <Field
            controlId={valueId}
            label={
              mode === 'rotate'
                ? `New ${typeDefinition.valueLabel.toLowerCase()}`
                : typeDefinition.valueLabel
            }
            error={valueProblem}
          >
            <Input
              size="lg"
              type="password"
              value={value}
              spellCheck={false}
              autoComplete="off"
              placeholder={typeDefinition.valuePlaceholder}
              onChange={(event) => {
                edited('value')
                setValue(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
            />
          </Field>
        )}

        {mode !== 'rotate' && (
          <>
            <Field controlId={descriptionId} label="Description">
              <Input
                size="lg"
                value={description}
                maxLength={500}
                placeholder="What uses this credential?"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Tags">
              <Input
                size="lg"
                value={tags}
                placeholder="production, database"
                onChange={(event) => setTags(event.target.value)}
              />
            </Field>
          </>
        )}
        {problem && <ProblemLine {...problem} />}
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        {/* Live: pressing it with an empty required field names the field instead of doing
            nothing. Only a save in flight disables it. */}
        <Button aria-busy={busy} onClick={() => void submit()} disabled={busy}>
          {busy ? (
            <ActivitySignal
              label={
                mode === 'create' ? 'Adding item' : mode === 'edit' ? 'Saving' : 'Creating version'
              }
              className="text-xs [&_.lx-activity-orb]:text-current"
              labelClassName="min-w-0"
            />
          ) : mode === 'create' ? (
            'Add item'
          ) : mode === 'edit' ? (
            'Save metadata'
          ) : (
            'Create version'
          )}
        </Button>
      </DialogFooter>
    </>
  )
}

export function VaultItemDialog(props: VaultItemDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg">
        <VaultItemDialogBody {...props} />
      </DialogContent>
    </Dialog>
  )
}
