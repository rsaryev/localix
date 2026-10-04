import { Braces, Check, Copy, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import type { SecretMeta } from '@localixai/api/client'

/**
 * What you can do to one vault item, described once.
 *
 * Reached two ways: the details pane's kebab, and a right-click on the item's row in the list —
 * where nothing was reachable at all before, because the row's only behaviour was to select
 * itself and every action lived in the pane the selection opened.
 *
 * A provider- or system-managed item is not ours to rotate or delete, so those rows are ABSENT
 * rather than disabled: there is nothing the user could do here to gain the permission, and a
 * greyed row would imply otherwise.
 */
export interface VaultItemMenuOps {
  /** Which key's copy just succeeded, so the row can flip to a checkmark. */
  copied: string | null
  onCopy: (item: SecretMeta, template?: boolean) => void
  onEdit: () => void
  onRotate: () => void
  onDelete: () => void
}

export function vaultItemMenu(item: SecretMeta, ops: VaultItemMenuOps): MenuEntry[] {
  const managed = item.source === 'provider' || item.source === 'system'
  return [
    {
      id: 'copy-reference',
      label: 'Copy reference',
      icon: ops.copied === item.key ? Check : Copy,
      onSelect: () => ops.onCopy(item),
    },
    ...(item.reference
      ? ([
          {
            id: 'copy-template',
            label: 'Copy interpolation',
            icon: ops.copied === `${item.key}:template` ? Check : Braces,
            onSelect: () => ops.onCopy(item, true),
          },
        ] satisfies MenuEntry[])
      : []),
    { separator: true },
    { id: 'edit', label: 'Edit metadata', icon: Pencil, onSelect: ops.onEdit },
    ...(managed
      ? []
      : ([
          { id: 'rotate', label: 'Rotate value', icon: RefreshCw, onSelect: ops.onRotate },
          { separator: true },
          {
            id: 'delete',
            label: 'Delete item',
            icon: Trash2,
            danger: true,
            onSelect: ops.onDelete,
          },
        ] satisfies MenuEntry[])),
  ]
}
