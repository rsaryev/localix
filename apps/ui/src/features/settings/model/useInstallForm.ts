import { useState } from 'react'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { focusFirstInvalid } from '@/shared/lib/forms/fieldErrors'

/** The one id shared by the source `Field` and focus-on-submit. */
export const INSTALL_SOURCE_ID = 'install-source'

export interface InstallFormDeps {
  /** Performs the install (source already trimmed). Throws on failure. */
  install: (source: string, enable: boolean) => Promise<unknown>
  /** Re-fetch the list after a successful install. */
  refresh: () => void
  /** Initial/reset state for the post-install enable checkbox. */
  defaultEnable?: boolean
}

export interface InstallForm {
  installing: boolean
  source: string
  setSource: (v: string) => void
  installEnable: boolean
  setInstallEnable: (v: boolean) => void
  busy: boolean
  /** A failed INSTALL — the pinned row beside the button that caused it. */
  error: string | null
  /** What is wrong with the SOURCE field, rendered under it. */
  sourceError: string | null
  /** Open the install form (clears any prior error). */
  open: () => void
  /** Close/cancel the install form. */
  close: () => void
  /** Validate + run the install; on success clears the form and refreshes. */
  submit: () => Promise<void>
}

/**
 * Local-path / git-URL install form state machine, shared by the plugins and
 * plugins settings panel (only the install call and
 * copy differ). Extracted from those components to avoid duplicating the
 * open/source/enable/busy state and the submit handler.
 */
export function useInstallForm({
  install,
  refresh,
  defaultEnable = false,
}: InstallFormDeps): InstallForm {
  const [installing, setInstalling] = useState(false)
  const [source, setSource] = useState('')
  const [installEnable, setInstallEnable] = useState(defaultEnable)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)

  const open = () => {
    setInstalling(true)
    setError(null)
    setSourceError(null)
  }
  const close = () => {
    setInstalling(false)
    setError(null)
    setSourceError(null)
  }

  const submit = async () => {
    if (!source.trim()) {
      // Under the field, not in the pinned row: it is a fact about that one input, and the
      // row above the footer is where a failed INSTALL belongs. See `forms/fieldErrors.ts`.
      const message = 'Enter a local directory path, a git URL, or owner/repo.'
      setSourceError(message)
      setError(null)
      focusFirstInvalid({ source: message }, { source: INSTALL_SOURCE_ID })
      return
    }
    setSourceError(null)
    setBusy(true)
    setError(null)
    try {
      await install(source.trim(), installEnable)
      setInstalling(false)
      setSource('')
      setInstallEnable(defaultEnable)
      refresh()
    } catch (e) {
      setError(inlineFailure(e, 'The install did not complete.'))
    } finally {
      setBusy(false)
    }
  }

  return {
    installing,
    source,
    setSource,
    installEnable,
    setInstallEnable,
    busy,
    error,
    sourceError,
    open,
    close,
    submit,
  }
}
