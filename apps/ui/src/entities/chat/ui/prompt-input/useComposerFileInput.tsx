import { useCallback, useRef } from 'react'

import { filesFromDesktopPick } from '@/shared/lib/attachments/file-staging'
import { desktopPickFiles } from '@/shared/lib/desktopDialogs'

/**
 * The paperclip's file picker: the desktop shell's own dialog when there is one, else the hidden
 * file input this returns for the composer to render. Either way the picked files are staged
 * through `handleFiles`.
 */
export function useComposerFileInput(handleFiles: (files: File[]) => void) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openPicker = useCallback(async () => {
    const files = filesFromDesktopPick(await desktopPickFiles())
    if (files === undefined) {
      fileInputRef.current?.click()
      return
    }
    // Opened without `extensions` on purpose, like the input below without `accept`: the composer
    // stages every kind of file rather than refusing after the pick.
    handleFiles(files)
  }, [handleFiles])
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
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
