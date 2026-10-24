import { useCallback, useRef } from 'react'

import { acceptAttribute, type AttachmentGate } from '@/shared/lib/attachment-policy'
import { filesFromDesktopPick } from '@/shared/lib/attachments/file-staging'
import { desktopPickFiles } from '@/shared/lib/desktopDialogs'

/**
 * The paperclip's file picker: the desktop shell's own dialog when there is one, else the hidden
 * file input this returns for the composer to render. Either way the picked files are staged
 * through `handleFiles`.
 */
export function useComposerFilePicker(
  handleFiles: (files: File[]) => void,
  attachmentGate: AttachmentGate | undefined,
) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openPicker = useCallback(async () => {
    const files = filesFromDesktopPick(await desktopPickFiles())
    if (files === undefined) {
      fileInputRef.current?.click()
      return
    }
    // Opened without `extensions` on purpose: `pick_files` filters by extension only, while the
    // browser input's `accept` hint is partly MIME types (`acceptAttribute`), so a filter here
    // would diverge from it. The composer stages every kind rather than refusing after the pick.
    handleFiles(files)
  }, [handleFiles])
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept={attachmentGate ? acceptAttribute(attachmentGate) : undefined}
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? [])
        if (files.length > 0) handleFiles(files)
        e.target.value = ''
      }}
    />
  )
  return { fileInput, openPicker }
}
