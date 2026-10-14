import { useState, type ReactNode } from 'react'
import { FileCode2 } from 'lucide-react'
import type { FileEditorContribution, FileEditorProps } from '@/shared/contrib/fileEditors'
import {
  BUILTIN_EDITOR_CHOICE,
  choiceKeyFor,
  rememberedFileEditor,
  rememberFileEditor,
} from '@/shared/contrib/fileEditorChoice'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Checkbox } from '@localixai/kit/checkbox'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { SurfaceErrorBoundary } from '@/shared/ui/SurfaceErrorBoundary'

import { initialFileEditorSelection } from './fileEditorSelection'

/**
 * One choice in the flat list. The rows are full-bleed inside a ruled list rather than inset
 * sidebar rows, so they are not WorkbenchListRow; they did lack the keyboard indicator every
 * other clickable row carries.
 */
const CHOICE_ROW =
  'flex w-full items-center gap-2 px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-surface-hover focus-ring'

/**
 * "Open with" chooser — rendered when several contributed editors match, or a
 * contribution collides with a meaningful native viewer. The user decides once
 * per extension (unless they uncheck persistence), and the native surface stays
 * available as a first-class option.
 */
export function FileEditorPicker({
  fileKey,
  options,
  fallbackLabel,
  preferenceKey,
  onPick,
}: {
  /** The routing key the contributions matched (path, or media name). */
  fileKey: string
  options: FileEditorContribution[]
  /** Label of the built-in fallback (e.g. "Code editor" / "File viewer"). */
  fallbackLabel: string
  preferenceKey?: string
  /** `null` = the built-in fallback. */
  onPick: (contributionId: string | null) => void
}) {
  const [remember, setRemember] = useState(true)
  const ext = preferenceKey ?? choiceKeyFor(fileKey)

  const pick = (id: string | null) => {
    if (remember) rememberFileEditor(fileKey, id ?? BUILTIN_EDITOR_CHOICE, preferenceKey)
    onPick(id)
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-1 text-sm font-medium text-foreground">
          Open “{baseName(fileKey)}” with…
        </div>
        <div className="mb-3 text-xs text-text-soft">
          {options.length > 1
            ? 'Several installed editors can open this file.'
            : 'An installed editor and the built-in viewer can open this file.'}
        </div>
        <div className={DIVIDED_LIST}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={cn(CHOICE_ROW, 'text-foreground')}
              onClick={() => pick(o.id)}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            className={cn(CHOICE_ROW, 'text-text-soft')}
            onClick={() => pick(null)}
          >
            <FileCode2 className="size-4" />
            {fallbackLabel}
          </button>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-text-soft">
          <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember for .{ext} files
        </label>
      </div>
    </div>
  )
}

/**
 * The grid's file-tab body when contributed editors matched: renders the single
 * match, the remembered choice, or the chooser. The pick is per-tab state on top
 * of the per-extension memory, so choosing re-renders THIS tab immediately.
 */
export function ContributedFileBody({
  matches,
  fileKey,
  fallbackLabel,
  preferenceKey,
  offerNativeChoice = false,
  requestedBuiltin = false,
  editorProps,
  renderFallback,
}: {
  matches: FileEditorContribution[]
  fileKey: string
  fallbackLabel: string
  preferenceKey?: string
  offerNativeChoice?: boolean
  /**
   * The OPEN asked for the built-in code editor. A registered editor otherwise wins silently
   * when it is the only match, so this is the only way a caller can say "show me the text" for
   * a file type a plugin owns. Not remembered: it is this request's intent, not a preference.
   */
  requestedBuiltin?: boolean
  editorProps: FileEditorProps
  renderFallback: () => ReactNode
}) {
  const [picked, setPicked] = useState<string | null>(() =>
    initialFileEditorSelection(
      matches.map((match) => match.id),
      rememberedFileEditor(fileKey, preferenceKey),
      offerNativeChoice,
      requestedBuiltin,
    ),
  )

  // The pick is per-tab STATE, so a re-open of an already-mounted tab never re-runs the
  // initializer — and a re-open is exactly how "show me the text" arrives for a file whose
  // tab already shows a plugin editor. `revealAt` is stamped by every open request, so a
  // changed value IS a new request; honour its builtin ask, and only its (a plain re-open
  // must not clobber what the person picked).
  const [seenRevealAt, setSeenRevealAt] = useState(editorProps.revealAt)
  if (editorProps.revealAt !== seenRevealAt) {
    setSeenRevealAt(editorProps.revealAt)
    if (requestedBuiltin && picked !== BUILTIN_EDITOR_CHOICE) setPicked(BUILTIN_EDITOR_CHOICE)
  }

  if (picked === BUILTIN_EDITOR_CHOICE) return renderFallback()
  const chosen = picked ? matches.find((m) => m.id === picked) : undefined
  if (chosen) {
    const Tab = chosen.Component
    // A contributed file editor is plugin code on the same footing as a contributed tab body.
    return (
      <SurfaceErrorBoundary key={chosen.id} surface={`The ${chosen.id} editor`}>
        <Tab {...editorProps} />
      </SurfaceErrorBoundary>
    )
  }
  return (
    <FileEditorPicker
      fileKey={fileKey}
      options={matches}
      fallbackLabel={fallbackLabel}
      preferenceKey={preferenceKey}
      onPick={(id) => setPicked(id ?? BUILTIN_EDITOR_CHOICE)}
    />
  )
}
