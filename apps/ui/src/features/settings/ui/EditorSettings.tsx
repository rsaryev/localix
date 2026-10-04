import { SettingsPage, SettingsRows, SettingsSection } from './SettingsScaffold'
import { setAutoSave, useAutoSave } from '@/shared/ui/code-editor/autoSave'
import { useSyncExternalStore } from 'react'
import { useUserSettings } from '../model/useUserSettings'
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

  const followAgentEdits = settings.agentSettings?.followAgentEdits?.enabled ?? false
  const toggleFollowAgentEdits = () => {
    const base = liveAgent()
    update({
      agentSettings: {
        ...base,
        followAgentEdits: { enabled: !(base.followAgentEdits?.enabled ?? false) },
      },
    })
  }

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
    <SettingsPage
      title="Editor"
      description="How the code editor saves and what it paints on top of your file. Model-backed assists live in the model drawer."
    >
      <SettingsSection
        anchor="editor-editing"
        title="Editing"
        description="Day-to-day editor behaviour while you and the agent work in the same files."
      >
        <SettingsRows>
          <SwitchRow
            title="Auto save after delay"
            description={
              autoSave
                ? `On — saves ~1s after you stop typing. Saves go through the same concurrency check as ${formatChordText('mod+s')}, so a file changed on disk still prompts to reconcile.`
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
                ? 'On — a single click opens the file in one reusable preview tab; a double-click, or editing it, pins the tab. Browsing a tree does not bury the workspace in tabs.'
                : 'Off — every file opens in its own tab and nothing is ever replaced.'
            }
            checked={previewTabs}
            onChange={() => setPreviewTabs(!previewTabs)}
            label="Open files in a reusable preview tab"
          />
          <SwitchRow
            title="Follow the agent’s edits"
            description={
              followAgentEdits
                ? 'On — the editor gently reveals the code file the agent is editing so you can watch it work. Only the session you’re viewing, never over the chat.'
                : 'Off — the workspace stays where you left it while the agent works.'
            }
            checked={followAgentEdits}
            onChange={toggleFollowAgentEdits}
            label="Follow the agent’s edits"
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        anchor="editor-on-save"
        title="On save"
        description="Transforms applied to a file's content when it is saved — explicit save, auto save, and conflict overwrite all funnel through the same path. They compose as format → trim → final newline."
      >
        <SettingsRows>
          <SwitchRow
            title="Format on save"
            description="Run the language server's formatter before the file is written. On by default. A language with no formatter — or a slow/failing one — falls through to a plain save; a save is never blocked or lost."
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
        title="Appearance"
        description="Native editor presentation and passive overlays. These settings never change file contents."
      >
        <SettingsRows>
          <SwitchRow
            title="Inline git blame"
            description="Show who last changed the current line — author, relative date, and commit summary — as a dimmed annotation at the end of the caret's line. On by default; it's plain `git blame`."
            checked={gitBlameEnabled}
            onChange={() => {
              const base = liveAgent()
              update({ agentSettings: { ...base, gitBlame: { enabled: !gitBlameEnabled } } })
            }}
            label="Enable inline git blame"
          />
          <SwitchRow
            title="Git change scrollbar markers"
            description="Show added, modified, and deleted Git hunks in Monaco's overview ruler. Diagnostic and search markers remain controlled by their native features. On by default."
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
            description="Colour matching brackets ( ) [ ] { } by nesting depth so nested code is easier to scan — the classic “rainbow brackets”. On by default."
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
