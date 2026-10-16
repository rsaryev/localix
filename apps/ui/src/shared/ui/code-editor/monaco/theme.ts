import type { MonacoApi } from './runtime'

const THEME_NAME = 'localix-native'

/** A `--syntax-code-*` token, so the editor scheme is theme-owned like the chrome. */
function syntax(name: string, fallback: string): string {
  return cssColor(`--syntax-code-${name}`, fallback)
}

function cssColor(token: string, fallback: string): string {
  const value =
    getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return fallback
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  return `#${[red, green, blue, alpha]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function isLightSurface(): boolean {
  const color = cssColor('--background', '#171717')
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 150
}

export function defineLocalixMonacoTheme(monaco: MonacoApi): string {
  const light = isLightSurface()
  const foreground = cssColor('--foreground', light ? '#2b2b2b' : '#f5f5f5')
  // Under the macOS glass theme `--background` carries alpha, and Monaco compounds it with the
  // pane's own coat — so the editor BODY paints nothing at all (the hosting pane owns the ground;
  // monacoEditor.css clears the DOM copies of the same paint). Sticky scroll adopts the kit's
  // occluder; inputs need an actually solid ground to be readable, which is what
  // `--background-solid` exists for — it equals `--background` everywhere glass is off.
  const background = '#00000000'
  const ground = cssColor('--background-solid', light ? '#f8f8f8' : '#171717')
  // Every floating panel MONACO draws (hover docs, autocomplete, its own right-click menu) — the
  // same "elevated, not sunken" material the rest of the app's popovers/menus use (see
  // popover-surface.ts). `--surface-raised` is the sunken code/composer inset and is deliberately
  // darker than the editor body, which is why these widgets used to be nearly invisible against it.
  const elevated = cssColor('--popover', light ? '#ffffff' : '#2b2b2b')
  const muted = cssColor('--text-muted', light ? '#686868' : '#a1a1a1')
  const faint = cssColor('--text-faint', light ? '#999999' : '#666666')
  const border = cssColor('--control-border', light ? '#d4d4d4' : '#3f3f3f')
  const hover = cssColor('--surface-hover', light ? '#ededed' : '#252525')
  const active = cssColor('--surface-active', light ? '#e4e4e4' : '#303030')
  // The highlighted-row state for anything sitting ON `elevated` (suggest widget, hover-doc status
  // bar, the right-click menu) rather than on the editor body — `--popover-hover` stays lighter
  // than `elevated` in every theme/mode the same way `hover` stays lighter than `background`.
  const elevatedHover = cssColor('--popover-hover', light ? '#e9e9e9' : '#333333')
  const info = cssColor('--status-info', light ? '#2563eb' : '#60a5fa')
  const error = cssColor('--status-error', light ? '#c62828' : '#ef6b73')
  const warning = cssColor('--status-warning', light ? '#986700' : '#e5b454')
  const success = cssColor('--status-success', light ? '#27864a' : '#58b77a')

  monaco.editor.defineTheme(THEME_NAME, {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      // The SAME `--syntax-code-*` tokens the file viewer uses (see sugarHighTheme.ts),
      // which is what finally makes "reading a file and editing it render with
      // identical colors" true — this used to be a third hardcoded palette that
      // disagreed with both others, and being hardcoded it also put the editor scheme
      // out of a theme's reach.
      { token: 'comment', foreground: syntax('comment', faint).slice(1), fontStyle: 'italic' },
      { token: 'keyword', foreground: syntax('keyword', light ? '#cf222e' : '#ff7b72').slice(1) },
      { token: 'string', foreground: syntax('string', light ? '#0a3069' : '#a5d6ff').slice(1) },
      { token: 'number', foreground: syntax('literal', light ? '#953800' : '#ffa657').slice(1) },
      { token: 'type', foreground: syntax('class', light ? '#116329' : '#7ee787').slice(1) },
      { token: 'identifier', foreground: foreground.slice(1) },
    ],
    colors: {
      'editor.background': background,
      'editor.foreground': foreground,
      'editorLineNumber.foreground': faint,
      'editorLineNumber.activeForeground': muted,
      'editorCursor.foreground': foreground,
      'editor.selectionBackground': `${info.slice(0, 7)}3d`,
      'editor.inactiveSelectionBackground': `${info.slice(0, 7)}24`,
      'editor.lineHighlightBackground': `${foreground.slice(0, 7)}0a`,
      'editorIndentGuide.background1': `${foreground.slice(0, 7)}16`,
      'editorIndentGuide.activeBackground1': `${foreground.slice(0, 7)}35`,
      'editorWhitespace.foreground': `${foreground.slice(0, 7)}2b`,
      'editorGutter.background': background,
      'editorWidget.background': elevated,
      'editorWidget.foreground': foreground,
      'editorWidget.border': border,
      'editorWidget.resizeBorder': info,
      'editorHoverWidget.background': elevated,
      'editorHoverWidget.foreground': foreground,
      'editorHoverWidget.border': border,
      'editorHoverWidget.statusBarBackground': elevatedHover,
      'editorLink.activeForeground': info,
      'editorSuggestWidget.background': elevated,
      'editorSuggestWidget.foreground': foreground,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': elevatedHover,
      'editorSuggestWidget.selectedForeground': foreground,
      'editorSuggestWidget.highlightForeground': info,
      'editorSuggestWidget.focusHighlightForeground': info,
      'editorActionList.background': elevated,
      'editorActionList.foreground': foreground,
      'editorActionList.focusBackground': elevatedHover,
      'editorActionList.focusForeground': foreground,
      'editorStickyScroll.background': background,
      'editorStickyScrollGutter.background': background,
      'editorStickyScroll.border': cssColor('--color-border-soft', border),
      'editorStickyScroll.shadow': '#00000000',
      'editorStickyScrollHover.background': hover,
      'editorOverviewRuler.border': '#00000000',
      'editorError.foreground': error,
      'editorWarning.foreground': warning,
      'editorInfo.foreground': info,
      'editorHint.foreground': success,
      // Unused code (a diagnostic tagged Unnecessary) is drawn at half strength — Monaco reads
      // only this colour's ALPHA as the span's opacity. Its default (0xaa, ~67%) left an unused
      // declaration too close to a used one to notice at a glance.
      'editorUnnecessaryCode.opacity': '#00000080',
      'editorGhostText.foreground': muted,
      'peekView.border': border,
      'peekViewTitle.background': background,
      'peekViewTitleLabel.foreground': foreground,
      'peekViewTitleDescription.foreground': muted,
      'peekViewResult.background': background,
      'peekViewResult.lineForeground': foreground,
      'peekViewResult.fileForeground': foreground,
      'peekViewResult.selectionBackground': active,
      'peekViewResult.selectionForeground': foreground,
      'peekViewResult.matchHighlightBackground': `${info.slice(0, 7)}24`,
      'peekViewEditor.background': background,
      'peekViewEditorGutter.background': background,
      'peekViewEditorStickyScroll.background': background,
      'peekViewEditorStickyScrollGutter.background': background,
      'peekViewEditor.matchHighlightBackground': `${info.slice(0, 7)}24`,
      'peekViewEditor.matchHighlightBorder': `${info.slice(0, 7)}60`,
      'badge.background': hover,
      'badge.foreground': muted,
      'list.activeSelectionBackground': active,
      'list.activeSelectionForeground': foreground,
      'list.inactiveSelectionBackground': hover,
      'list.inactiveSelectionForeground': foreground,
      'list.focusOutline': border,
      'inlineEdit.originalBackground': `${error.slice(0, 7)}24`,
      'inlineEdit.modifiedBackground': `${success.slice(0, 7)}26`,
      'inlineEdit.originalChangedLineBackground': `${error.slice(0, 7)}33`,
      'inlineEdit.originalChangedTextBackground': `${error.slice(0, 7)}52`,
      'inlineEdit.modifiedChangedLineBackground': `${success.slice(0, 7)}38`,
      'inlineEdit.modifiedChangedTextBackground': `${success.slice(0, 7)}57`,
      'inlineEdit.originalBorder': `${error.slice(0, 7)}ad`,
      'inlineEdit.modifiedBorder': `${success.slice(0, 7)}ad`,
      'inlineEdit.tabWillAcceptOriginalBorder': error,
      'inlineEdit.tabWillAcceptModifiedBorder': success,
      'inlineEdit.gutterIndicator.primaryForeground': ground,
      'inlineEdit.gutterIndicator.primaryBorder': info,
      'inlineEdit.gutterIndicator.primaryBackground': info,
      'inlineEdit.gutterIndicator.secondaryForeground': foreground,
      'inlineEdit.gutterIndicator.secondaryBorder': border,
      'inlineEdit.gutterIndicator.secondaryBackground': hover,
      'inlineEdit.gutterIndicator.successfulForeground': ground,
      'inlineEdit.gutterIndicator.successfulBorder': success,
      'inlineEdit.gutterIndicator.successfulBackground': success,
      'inlineEdit.gutterIndicator.background': `${foreground.slice(0, 7)}14`,
      'input.background': ground,
      'input.foreground': foreground,
      'input.border': border,
      'input.placeholderForeground': faint,
      focusBorder: cssColor('--control-border-focus', info),
      disabledForeground: faint,
      'widget.shadow': '#00000047',
      'menu.background': elevated,
      'menu.foreground': foreground,
      'menu.selectionBackground': elevatedHover,
      'menu.selectionForeground': foreground,
      'menu.selectionBorder': border,
      'menu.separatorBackground': border,
      'menu.border': border,
      // `menu.selectionBackground` above is DEAD for every menu Monaco's own menu widget draws
      // (the peek-view dropdowns are the ones left, now that the editor's right-click menu is the
      // app's — see `editorContextMenu.ts`): the widget reads its selection fill from
      // `list.hoverBackground` / `list.hoverForeground` instead (see `defaultMenuStyles` in
      // vs/platform/theme/browser/defaultStyles.js). The `menu.*` pair stays because the standalone
      // select/dropdown widgets DO read it.
      'list.hoverBackground': elevatedHover,
      'list.hoverForeground': foreground,
      // The command palette and Monaco's own `<select>` replacements, which otherwise fall back to
      // Monaco's built-in greys — a fixed colour that belongs to neither of this app's themes.
      'quickInput.background': elevated,
      'quickInput.foreground': foreground,
      'quickInputTitle.background': elevatedHover,
      'dropdown.background': elevated,
      'dropdown.foreground': foreground,
      'dropdown.border': border,
      'keybindingLabel.background': elevatedHover,
      'keybindingLabel.foreground': foreground,
      'keybindingLabel.border': border,
      'keybindingLabel.bottomBorder': border,
      'scrollbarSlider.background': `${foreground.slice(0, 7)}20`,
      'scrollbarSlider.hoverBackground': `${foreground.slice(0, 7)}38`,
      'scrollbarSlider.activeBackground': `${foreground.slice(0, 7)}4f`,
    },
  })
  return THEME_NAME
}

export function watchLocalixMonacoTheme(
  monaco: MonacoApi,
  apply: (name: string) => void,
): () => void {
  const refresh = () => apply(defineLocalixMonacoTheme(monaco))
  refresh()
  const observer = new MutationObserver(refresh)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style', 'class'],
  })
  return () => observer.disconnect()
}
