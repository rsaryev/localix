import type { PendingDelete } from './useFileTree'

/** Confirm-dialog copy for a pending single- or multi-row delete. `permanent`
 *  distinguishes the reversible move-to-trash (default) from a Shift+Delete that
 *  removes the entry for good. (Remote sessions have no local trash and
 *  always delete permanently — noted here so the copy never over-promises undo.) */
export function describeDeletion(
  targets: PendingDelete[],
  permanent: boolean,
): { title?: string; description?: string } {
  if (targets.length === 0) return {}
  const tail = permanent ? 'This cannot be undone.' : 'It will move to Trash — you can undo this.'
  if (targets.length === 1) {
    const t = targets[0]
    return {
      title:
        t.type === 'dir'
          ? permanent
            ? 'Delete folder permanently?'
            : 'Delete folder?'
          : permanent
            ? 'Delete file permanently?'
            : 'Delete file?',
      description: `“${t.name}”${t.type === 'dir' ? ' and its contents' : ''} will be ${permanent ? 'permanently deleted' : 'moved to Trash'}. ${tail}`,
    }
  }
  const hasDir = targets.some((t) => t.type === 'dir')
  return {
    title: permanent
      ? `Delete ${targets.length} items permanently?`
      : `Delete ${targets.length} items?`,
    description: `${targets.length} items${hasDir ? ' (including folder contents)' : ''} will be ${permanent ? 'permanently deleted' : 'moved to Trash'}. ${tail}`,
  }
}
