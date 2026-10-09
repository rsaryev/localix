import type { FileDraftSnapshot } from '../model/fileDrafts'
import type { FileConflict } from './fileEditorContracts'
import type { readyStateFor } from './fileLoadState'

interface FileEditorSnapshot {
  buffer: string
  baseContent: string
  baseHash: string
  conflict: FileConflict | null
}

/** Callers decide when to surface the conflict; cached first paint waits for revalidation. */
export function editorSnapshotFor(
  ready: ReturnType<typeof readyStateFor> | null,
  draft?: string,
  snapshot?: FileDraftSnapshot,
): FileEditorSnapshot {
  if (!ready?.editable) {
    return { buffer: '', baseContent: '', baseHash: '', conflict: null }
  }
  return {
    buffer: draft !== undefined && draft !== ready.content ? draft : ready.content,
    baseContent: snapshot?.baseContent ?? ready.content,
    baseHash: snapshot?.baseHash ?? ready.hash ?? '',
    conflict:
      snapshot && ready.hash && ready.hash !== snapshot.baseHash
        ? { diskContent: ready.content, diskHash: ready.hash }
        : null,
  }
}
