import { useCallback } from 'react'
import { fileEditorsFor, type FileEditorContribution } from './fileEditors'
import { useMiniAppRegistrySlice } from './useMiniAppRegistrySlice'

/**
 * The contributed editors for an open file (`fileEditorsFor`), read through the registry's
 * subscription: a mini app installed, enabled or disabled while the file is open hands its tab
 * over at once. A plain call during render kept the first answer in the built app, where the React
 * Compiler memoizes it on the key, so a CSV stayed in the code editor until it was opened again.
 */
export function useFileEditorsFor(key: string): FileEditorContribution[] {
  const select = useCallback(() => fileEditorsFor(key), [key])
  return useMiniAppRegistrySlice(`file-editors:${key}`, select)
}
