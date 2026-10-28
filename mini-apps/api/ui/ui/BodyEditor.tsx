/**
 * The request-body editor — the same CodeEditor the SQL console uses, so a JSON body gets real
 * syntax highlighting, bracket matching, native JSON diagnostics, and `{{variable}}`
 * autocomplete against the active environment.
 */

import { useEffect, useMemo, useRef } from 'react'
import { CodeEditor, type CompletionSource } from '@localixai/kit/code-editor'
import type { EnvVariable } from '../../backend/contracts'
import { editorLanguage, offsetAt, variableCompletions } from '../model/bodyEditor'

export function BodyEditor({
  value,
  mimeType,
  variables,
  onChange,
  onSave,
  onSubmit,
}: {
  value: string
  mimeType: string | undefined
  variables: ReadonlyArray<EnvVariable>
  onChange: (value: string) => void
  /** ⌘/Ctrl+S inside the editor — save the request. */
  onSave?: () => void
  /** ⌘/Ctrl+Enter inside the editor — save-and-send. */
  onSubmit?: () => void
}) {
  const language = editorLanguage(mimeType)

  // The live text, mirrored into a ref so the completion source reads the CURRENT document
  // without being re-created (and re-registered on the editor) on every keystroke.
  const textRef = useRef(value)
  const varsRef = useRef(variables)
  useEffect(() => {
    textRef.current = value
    varsRef.current = variables
  })

  const completionSource = useMemo<CompletionSource>(
    () => async (pos) => {
      const text = textRef.current
      return variableCompletions(text, offsetAt(text, pos.line, pos.character), varsRef.current)
    },
    [],
  )

  return (
    <CodeEditor
      value={value}
      language={language}
      ariaLabel="Request body"
      stickyScrollEnabled={false}
      onChange={onChange}
      onSave={onSave}
      onSubmit={onSubmit}
      submitActionLabel="Send Request"
      completionSource={completionSource}
      className="min-h-0 flex-1 border-0"
    />
  )
}
