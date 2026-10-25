import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { CreateForm, PackageKind, Scope } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Select } from '@localixai/kit/select'
import { useStoreScope } from '../model/storeContext'
import { useCreatable, useCreateForm } from '../model/useStoreData'
import { ConfigForm } from './ConfigForm'

/**
 * "Add …" for a kind whose provider can make an item (`docs/internals/store.md`, "Create and
 * actions"): a dialog with the provider's own form, rendered by the one configuration form, and
 * where to keep it when a project is open. A refusal is said in the dialog; success opens the new
 * item's page.
 */
function CreateDialog({
  kind,
  form,
  initial,
  onClose,
}: {
  kind: PackageKind
  form: CreateForm
  initial: Scope
  onClose: () => void
}) {
  const store = useStoreScope()
  const [scope, setScope] = useState<Scope>(initial)
  const scopes = form.scopes.filter((s) => s === 'user' || store.project)
  const where = scopes.includes(scope) ? scope : scopes[0]!
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add {form.noun}</DialogTitle>
          <DialogDescription className="sr-only">
            Fill in the {form.noun}, then add it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {scopes.length > 1 && (
            <Field label="Keep it for">
              <Select
                size="md"
                value={where}
                onValueChange={(next) => setScope(next as Scope)}
                options={scopes.map((value) => ({
                  value,
                  label: value === 'user' ? 'You' : (store.project?.name ?? 'This project'),
                }))}
                className="w-64"
              />
            </Field>
          )}
          <ConfigForm
            submitLabel="Add"
            config={{ fields: form.fields, values: {}, set: [], scope: where, scopes }}
            onSave={async (values) => {
              const ref = await store.client.create(
                kind,
                where,
                values,
                where === 'project' ? store.project?.id : undefined,
              )
              onClose()
              store.open(ref)
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/** One kind's Add button, drawn once its form is known. */
function CreateButton({ kind, initial }: { kind: PackageKind; initial: Scope }) {
  const store = useStoreScope()
  const form = useCreateForm(store.client, kind)
  const [open, setOpen] = useState(false)
  // A project-only form has nowhere to keep an item until a project is open.
  if (!form.data || !form.data.scopes.some((s) => s === 'user' || store.project)) return null
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" aria-hidden />
        Add {form.data.noun}
      </Button>
      {open && (
        <CreateDialog
          kind={kind}
          form={form.data}
          initial={initial}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** The Add buttons of a section: its own kind's, or every kind's on Yours and Project. */
export function CreateBar({
  kinds,
  initial = 'user',
}: {
  kinds: readonly PackageKind[] | 'all'
  /** Where a new one is kept unless the person chooses: the Project shelf says the project. */
  initial?: Scope
}) {
  const store = useStoreScope()
  const creatable = useCreatable(store.client).data ?? []
  const shown = kinds === 'all' ? creatable : creatable.filter((kind) => kinds.includes(kind))
  if (shown.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap justify-end gap-2">
      {shown.map((kind) => (
        <CreateButton key={kind} kind={kind} initial={initial} />
      ))}
    </div>
  )
}
