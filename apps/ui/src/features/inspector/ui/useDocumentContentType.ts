import { useCallback } from 'react'
import { useMiniAppRegistrySlice } from '@/shared/contrib/useMiniAppRegistrySlice'
import { contentTypeForPath } from '@/shared/lib/contentTypeRouting'

/**
 * The document format a dedicated viewer registered for `path`, if any. Read through the
 * registry subscription, so an open tab hands over when a viewer mini app is installed, enabled
 * or disabled: a plain call is memoized on `path` by the React Compiler in the built app.
 */
export function useDocumentContentType(path: string): string | undefined {
  const select = useCallback(() => contentTypeForPath(path), [path])
  return useMiniAppRegistrySlice(`document-content-type:${path}`, select)
}
