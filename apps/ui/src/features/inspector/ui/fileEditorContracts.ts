import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import type { PendingFileSave } from './fileSaveTask'

/** The file diverged on disk while the editor held unsaved edits — captured so the
 *  reconciliation banner can Compare / Overwrite / Reload against this exact snapshot. */
export interface FileConflict {
  /** Current on-disk content (what an external writer left). */
  diskContent: string
  /** Its concurrency token — the hash an Overwrite must echo back to win the save. */
  diskHash: string
}

/**
 * Runs the LSP formatter on `text` (the buffer being saved) and resolves with the
 * formatted text, or `null` when the language has no formatting provider, the
 * request errors, or the edits were computed for other text. Provided by FileTab
 * (where `formatSource` + the setting are in scope) via a ref so `save()` reads
 * the live value without the hook needing the LSP layer as an argument.
 */
export type FormatOnSaveRunner = (text: string) => Promise<string | null>

/** Mutable file state shared by ordinary saves and conflict overwrites. */
export interface FileEditorWriteState {
  bufferRef: RefObject<string>
  baseContentRef: RefObject<string>
  baseHashRef: RefObject<string>
  lastSyncedRef: RefObject<string>
  savingRef: RefObject<boolean>
  savePromiseRef: RefObject<PendingFileSave | null>
  setSaving: Dispatch<SetStateAction<boolean>>
  setEditError: Dispatch<SetStateAction<Problem | null>>
  setBaseHash: Dispatch<SetStateAction<string>>
  setBaseContent: Dispatch<SetStateAction<string>>
  setBuffer: Dispatch<SetStateAction<string>>
  setConflict: Dispatch<SetStateAction<FileConflict | null>>
}
