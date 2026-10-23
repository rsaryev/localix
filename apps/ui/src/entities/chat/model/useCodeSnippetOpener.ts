import { useEffect } from 'react'
import { codeSnippet } from '@/shared/lib/codeSnippetBus'
import { inspector } from '@/shared/lib/inspectorBus'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

/** sha256 of the empty string — the base hash for creating a brand-new file in one write
 *  (the server compares against the empty on-disk content of a not-yet-existing path). */
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/**
 * Wires the code-block "Open" action (via {@link codeSnippet}) to materialize the snippet as a
 * per-session scratch file with the given extension and open it in the editor, where
 * extension routing takes over. Files land under the session's `.localix/tmp/sessions/<id>/` (kept out of the
 * user's tree); each open gets a unique name so the write is always a clean create (base hash
 * = sha256 of empty). GENERIC — names no language/subsystem. Mount once in the chat page.
 */
export function useCodeSnippetOpener(): void {
  useEffect(
    () =>
      // The snippet's own chat (the transcript that holds the block), never the one on screen.
      codeSnippet.setHandler(({ sessionId, ext, code }) => {
        const stamp = Date.now().toString(36)
        const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : 'txt'
        const path = `.localix/tmp/sessions/${sessionId}/snippet-${stamp}.${safeExt}`
        void backendClient
          .writeFileContent(sessionId, path, code, SHA256_EMPTY)
          .then((res) => inspector.openFile({ sessionId, path: res.path }))
          .catch((err: unknown) =>
            toast.error('Could not open this snippet as a file', {
              description: errorMessage(err, '') || undefined,
            }),
          )
      }),
    [],
  )
}
