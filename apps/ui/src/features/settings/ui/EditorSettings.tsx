import { SettingsPage, SettingsRows, SettingsSection } from './SettingsScaffold'
import { setAutoSave, useAutoSave } from '@/shared/ui/code-editor/autoSave'
import { useSyncExternalStore } from 'react'
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import { SwitchRow } from './SwitchRow'
import { getWordWrap, setWordWrap, subscribeWordWrap } from '@/shared/ui/code-editor/wordWrap'
import {
  getRenderWhitespace,
  setRenderWhitespace,
  subscribeRenderWhitespace,
} from '@/shared/ui/code-editor/renderWhitespace'
import {
  getInlayHintsEnabled,
  setInlayHintsEnabled,
  subscribeInlayHintsEnabled,
} from '@/shared/ui/code-editor/inlayHintsPref'
import {
  getPreviewTabs,
  setPreviewTabs,
  subscribePreviewTabs,
} from '@/features/workspace-grid/model/store'
import { formatChordText } from '@/shared/lib/keybindings'

/**
 * Editor settings — editor-only behaviour: how a file saves and what it paints
 * on top of the buffer. Every model-backed assist is configured exclusively in
 * the model drawer.
 */

export function EditorSettings() {
  const { settings, update } = useUserSettings()
  const autoSave = useAutoSave()
  const wordWrap = useSyncExternalStore(subscribeWordWrap, getWordWrap, getWordWrap)
  const renderWhitespace = useSyncExternalStore(
    subscribeRenderWhitespace,
    getRenderWhitespace,
    getRenderWhitespace,
  )
  const inlayHints = useSyncExternalStore(
    subscribeInlayHintsEnabled,
    getInlayHintsEnabled,
    getInlayHintsEnabled,
  )
  const previewTabs = useSyncExternalStore(subscribePreviewTabs, getPreviewTabs, getPreviewTabs)

  // Read the LIVE agentSettings at mutation time (not the render closure) so two
  // quick toggles can't clobber each other: each handler rebuilds the patch from
  // the freshest stored value, then merges its own field.
  const liveAgent = () => useUserSettings.getState().settings.agentSettings ?? {}

  // On save — format runs first, then the two pure text cleanups compose on top.
  const formatOnSave = settings.agentSettings?.editorSave?.formatOnSave ?? true
  const trimOnSave = settings.agentSettings?.editorSave?.trimTrailingWhitespace ?? false
  const finalNewlineOnSave = settings.agentSettings?.editorSave?.ensureFinalNewline ?? false
  const setEditorSave = (
    patch: Partial<NonNullable<typeof settings.agentSettings>['editorSave']>,
  ) => {
    const base = liveAgent()
    update({ agentSettings: { ...base, editorSave: { ...base.editorSave, ...patch } } })
  }

  // Editor overlays — passive visual aids, no model.
  const gitBlameEnabled = settings.agentSettings?.gitBlame?.enabled ?? true
  const scrollbarMarkersEnabled = settings.agentSettings?.editorScrollbarMarkers?.enabled ?? true
  const bracketColorsEnabled = settings.agentSettings?.bracketPairColorization?.enabled ?? true

  return (
    <SettingsPage title="Editor" description="Set how files open, save, and appear in the editor.">
      <SettingsSection
        anchor="editor-editing"
        title="Editing"
        description="Control how files open and save as you edit."
      >
        <SettingsRows>
          <SwitchRow
            title="Auto save after delay"
            description={
              autoSave
                ? `Saves about one second after typing stops. Changes on disk still require reconciliation.`
                : `Off — save with ${formatChordText('mod+s')} or the toolbar button.`
            }
            checked={autoSave}
            onChange={() => setAutoSave(!autoSave)}
            label="Auto save after delay"
          />
          <SwitchRow
            title="Preview tabs"
            description={
              previewTabs
                ? 'Single-click reuses a preview tab. Double-click or edit to keep the file open.'
                : 'Every file opens in its own tab.'
            }
            checked={previewTabs}
            onChange={() => setPreviewTabs(!previewTabs)}
            label="Open files in a reusable preview tab"
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        anchor="editor-on-save"
        title="On save"
        scope="workspace"
        description="Apply in order: format, trim whitespace, then insert a final newline."
      >
        <SettingsRows>
          <SwitchRow
            title="Format on save"
            description="Format with the language server before saving. Save normally if formatting is unavailable or fails."
            checked={formatOnSave}
            onChange={() => setEditorSave({ formatOnSave: !formatOnSave })}
            label="Format document on save"
          />
          <SwitchRow
            title="Trim trailing whitespace"
            description="Strip trailing spaces and tabs from every line. Off by default."
            checked={trimOnSave}
            onChange={() => setEditorSave({ trimTrailingWhitespace: !trimOnSave })}
            label="Trim trailing whitespace on save"
          />
          <SwitchRow
            title="Insert final newline"
            description="Guarantee the file ends with exactly one trailing newline. Off by default."
            checked={finalNewlineOnSave}
            onChange={() => setEditorSave({ ensureFinalNewline: !finalNewlineOnSave })}
            label="Insert final newline on save"
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        anchor="editor-appearance"
        title="Code display"
        description="Visual aids that leave file contents unchanged."
      >
        <SettingsRows>
          <SwitchRow
            title="Git change scrollbar markers"
            description="Mark Git changes on the scrollbar. Diagnostic and search markers stay independent."
            checked={scrollbarMarkersEnabled}
            onChange={() => {
              const base = liveAgent()
              update({
                agentSettings: {
                  ...base,
                  editorScrollbarMarkers: { enabled: !scrollbarMarkersEnabled },
                },
              })
            }}
            label="Enable Git change scrollbar markers"
          />
          <SwitchRow
            title="Bracket pair colorization"
            description="Color matching brackets by nesting depth."
            checked={bracketColorsEnabled}
            onChange={() => {
              const base = liveAgent()
              update({
                agentSettings: {
                  ...base,
                  bracketPairColorization: { enabled: !bracketColorsEnabled },
                },
              })
            }}
            label="Enable bracket pair colorization"
          />
          <SwitchRow
            title="Word wrap"
            description="Wrap long lines inside the editor viewport. Also toggled by Monaco's native Alt+Z command."
            checked={wordWrap}
            onChange={() => setWordWrap(!wordWrap)}
            label="Enable editor word wrap"
          />
          <SwitchRow
            title="Render whitespace"
            description="Show spaces and tabs when they are selected, using Monaco's native whitespace renderer."
            checked={renderWhitespace}
            onChange={() => setRenderWhitespace(!renderWhitespace)}
            label="Render editor whitespace"
          />
        </SettingsRows>
      </SettingsSection>
      <SettingsSection
        anchor="editor-annotations"
        title="Annotations"
        description="Information displayed beside the code while you work."
      >
        <SettingsRows>
          <SwitchRow
            title="Inline git blame"
            description="Show the author, date, and commit beside the current line."
            checked={gitBlameEnabled}
            onChange={() => {
              const base = liveAgent()
              update({ agentSettings: { ...base, gitBlame: { enabled: !gitBlameEnabled } } })
            }}
            label="Enable inline git blame"
          />
          <SwitchRow
            title="Inlay hints"
            description="Show language-server parameter names and inferred types inline. On by default."
            checked={inlayHints}
            onChange={() => setInlayHintsEnabled(!inlayHints)}
            label="Enable editor inlay hints"
          />
        </SettingsRows>
      </SettingsSection>
    </SettingsPage>
  )
}
