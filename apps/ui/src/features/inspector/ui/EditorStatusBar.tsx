import { useMemo, useState } from 'react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import type { EditorCursorStatus } from '@/shared/ui/code-editor/CodeEditor'
import { SUPPORTED_LANGUAGE_IDS } from '@/shared/ui/code-editor/language'
import { detectIndentation } from '@/shared/lib/detectIndentation'
import { convertIndentation } from '@/shared/lib/convertIndentation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import {
  WorkbenchStatusBar,
  WorkbenchStatusButton,
  WorkbenchStatusItem,
} from '@localixai/kit/workbench-statusbar'

/** Human label for a `languageFromPath` id (e.g. "typescript" → "TypeScript"). */
const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  tsx: 'TSX',
  javascript: 'JavaScript',
  jsx: 'JSX',
  python: 'Python',
  bash: 'Shell',
  yaml: 'YAML',
  toml: 'TOML',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  markdown: 'Markdown',
  sql: 'SQL',
  dockerfile: 'Dockerfile',
  rust: 'Rust',
  go: 'Go',
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  ruby: 'Ruby',
  text: 'Plain Text',
}

function languageLabel(language?: string): string {
  if (!language) return 'Plain Text'
  return LANGUAGE_LABELS[language] ?? language.charAt(0).toUpperCase() + language.slice(1)
}

const TAB_WIDTH_CHOICES = [2, 4, 8] as const

/**
 * The indentation menu as described entries.
 *
 * It was hand-built: a styled `<div>` posing as the "Tab width" title (focusable by nothing,
 * announced as nothing) and an invisible `<Check>` on every width row, toggled by opacity — a
 * radio choice drawn as a checkbox, with no `aria-checked` for assistive technology. The shared
 * walker gives the title a real header and the widths `selected` rows; `keepOpen` keeps the old
 * "pick a width, then convert" flow in one opening.
 */
export function indentationMenuEntries({
  tabWidth,
  convert,
  setWidth,
}: {
  tabWidth: number
  convert: (to: 'spaces' | 'tabs') => void
  setWidth: (width: number) => void
}): MenuEntry[] {
  return [
    { id: 'to-spaces', label: 'Convert Indentation to Spaces', onSelect: () => convert('spaces') },
    { id: 'to-tabs', label: 'Convert Indentation to Tabs', onSelect: () => convert('tabs') },
    { separator: true },
    { header: 'Tab width' },
    ...TAB_WIDTH_CHOICES.map((width): MenuEntry => ({
      id: `width-${width}`,
      label: `${width} spaces`,
      selected: tabWidth === width,
      keepOpen: true,
      onSelect: () => setWidth(width),
    })),
  ]
}

/**
 * The language-mode menu as described entries.
 *
 * The reset row used to fold the detected language into its name — "Auto Detect (TypeScript)" —
 * which reads as part of the command; the detected value is the row's `hint` now, on the same
 * right edge every menu aligns its values on. The languages are `selected` rows for the reason the
 * widths are: a choice among siblings, marked at the end, announced as `menuitemradio`.
 */
export function languageMenuEntries({
  language,
  autoLanguage,
  overridden,
  onLanguageChange,
}: {
  language?: string
  autoLanguage?: string
  overridden: boolean
  onLanguageChange: (langId: string | null) => void
}): MenuEntry[] {
  const reset: MenuEntry[] =
    overridden && autoLanguage
      ? [
          {
            id: 'auto-detect',
            label: 'Auto detect',
            hint: languageLabel(autoLanguage),
            onSelect: () => onLanguageChange(null),
          },
          { separator: true },
        ]
      : []
  return [
    ...reset,
    ...SUPPORTED_LANGUAGE_IDS.map((id): MenuEntry => ({
      id: `lang-${id}`,
      label: languageLabel(id),
      selected: language === id,
      onSelect: () => onLanguageChange(id === autoLanguage ? null : id),
    })),
  ]
}

/**
 * Editor status ENTRIES: caret Ln/Col + selection size, detected
 * indentation, and language mode.
 *
 * These are contributed into the app's single status bar via
 * `WorkbenchStatusContribution` (see `shared/ui/workbench-status-host`)
 * instead of docking a second bar under the editor. The group is still a named
 * `WorkbenchStatusBar` so the entries keep one accessible name and the shared
 * `--statusbar-height` geometry; it simply renders inside the app bar now.
 *
 * When `onLanguageChange`/`autoLanguage` are supplied, the language label becomes
 * a "Change Language Mode" picker (⌘K M): the user can override the
 * highlighting grammar for this tab, or reset to the path-detected default.
 *
 * When `onConvertIndentation` is supplied, the indentation label becomes a menu
 * to convert the buffer's leading indentation to spaces/tabs and pick the tab
 * width.
 */
export function EditorStatusBar({
  cursor,
  text,
  language,
  autoLanguage,
  onLanguageChange,
  onConvertIndentation,
}: {
  cursor: EditorCursorStatus | null
  text: string
  /** The language currently applied to the editor (override or auto-detected). */
  language?: string
  /** The path-detected language, used to label the "Auto Detect" reset row. */
  autoLanguage?: string
  /** Set an explicit language id, or `null` to reset to `autoLanguage`. */
  onLanguageChange?: (langId: string | null) => void
  /** Replace the buffer with re-indented text (marks the tab dirty). */
  onConvertIndentation?: (nextText: string) => void
}) {
  const indent = useMemo(() => detectIndentation(text), [text])
  const [widthOverride, setWidthOverride] = useState<number | null>(null)
  const tabWidth = widthOverride ?? indent.size
  const indentLabel = indent.usesTabs ? `Tab Size: ${indent.size}` : `Spaces: ${indent.size}`

  const position = cursor
    ? cursor.selectedChars > 0
      ? `Ln ${cursor.line}, Col ${cursor.column} (${cursor.selectedChars} selected${
          cursor.selectedLines > 1 ? ` on ${cursor.selectedLines} lines` : ''
        })`
      : `Ln ${cursor.line}, Col ${cursor.column}`
    : 'Ln 1, Col 1'

  const overridden = onLanguageChange != null && autoLanguage != null && language !== autoLanguage

  return (
    <WorkbenchStatusBar aria-label="Editor status" align="end">
      <WorkbenchStatusItem
        className="tabular-nums"
        aria-label={`Cursor position: ${position}`}
        title={position}
      >
        {position}
      </WorkbenchStatusItem>
      {onConvertIndentation ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <WorkbenchStatusButton
              className="tabular-nums data-[state=open]:text-foreground"
              aria-label={`Indentation: ${indentLabel}. Click to convert.`}
            >
              {indentLabel}
            </WorkbenchStatusButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <MenuEntries
              family="dropdown"
              entries={indentationMenuEntries({
                tabWidth,
                convert: (to) => onConvertIndentation(convertIndentation(text, tabWidth, to)),
                setWidth: setWidthOverride,
              })}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <WorkbenchStatusItem className="tabular-nums" aria-label={`Indentation: ${indentLabel}`}>
          {indentLabel}
        </WorkbenchStatusItem>
      )}
      {onLanguageChange ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <WorkbenchStatusButton
              className="data-[state=open]:text-foreground"
              aria-label={`Language mode: ${languageLabel(language)}. Click to change.`}
            >
              {languageLabel(language)}
              {overridden && (
                <span className="ml-1 text-status-info" aria-hidden>
                  ●
                </span>
              )}
            </WorkbenchStatusButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
            <MenuEntries
              family="dropdown"
              entries={languageMenuEntries({
                language,
                autoLanguage,
                overridden,
                onLanguageChange,
              })}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <WorkbenchStatusItem aria-label={`Language mode: ${languageLabel(language)}`}>
          {languageLabel(language)}
        </WorkbenchStatusItem>
      )}
    </WorkbenchStatusBar>
  )
}
