import type * as FileTabModule from '../ui/FileTab'

let editorGraph: Promise<typeof FileTabModule> | undefined

/**
 * Load both stages of the cold code-editor graph in parallel.
 *
 * `FileTab` mounts `CodeEditor`, whose first effect otherwise discovers Monaco's
 * `runtimeBundle` only after the FileTab chunk has arrived and rendered. Keeping
 * both imports here also gives Explorer intent and React.lazy one retryable,
 * deduplicated promise without putting either heavy module back into startup.
 */
export function loadFileEditor(): Promise<typeof FileTabModule> {
  if (editorGraph) return editorGraph
  const attempt = Promise.all([
    import('../ui/FileTab'),
    import('@/shared/ui/code-editor/monaco/runtimeBundle'),
  ]).then(([fileTab]) => fileTab)
  editorGraph = attempt
  void attempt.catch(() => {
    if (editorGraph === attempt) editorGraph = undefined
  })
  return attempt
}
