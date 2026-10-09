import { useCallback, useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { SceneStrip } from './SceneStrip'
import type { PublishMessageContext } from '@localixai/plugin-sdk/ui'
import {
  documentSchema,
  formatIds,
  paletteIds,
  type MotionAsset,
  type MotionDocument,
  type MotionProject,
  type MotionScene,
} from '../shared/schema'
import { durationOf, framesOf, sceneAt } from '../shared/timing'
import { ChoiceMenu } from './ChoiceMenu'
import { SceneEditor } from './SceneEditor'
import { MediaSettings } from './MediaSettings'
import { Playback } from './Playback'
import { ExportPanel } from './ExportPanel'
import { motionMessageContext } from './bindings'
import { validateEditorNumbers } from './number-validity'

export function ProjectEditor({
  project,
  assets,
  active,
  sending,
  onSave,
  onUpload,
  onDirtyChange,
  publishMessageContext,
}: {
  project: MotionProject
  assets: MotionAsset[]
  active: boolean
  sending: boolean
  onSave: (revision: number, document: MotionDocument) => Promise<MotionProject | null>
  onUpload: (file: File) => Promise<MotionAsset | null>
  onDirtyChange: (dirty: boolean) => void
  publishMessageContext?: PublishMessageContext
}) {
  const [base, setBase] = useState(project)
  const [draft, setDraft] = useState(project.document)
  const [selected, setSelected] = useState(project.document.scenes[0]!.id)
  const [frame, setFrame] = useState(0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.document)
  const conflict = project.revision !== base.revision
  const valid = documentSchema.safeParse(draft)
  useEffect(() => {
    if (!dirty && project.revision !== base.revision) {
      setBase(project)
      setDraft(project.document)
    }
  }, [project, base.revision, dirty])
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    setFrame((frame) => Math.min(frame, framesOf(draft) - 1))
  }, [draft])
  const scene = draft.scenes.find((scene) => scene.id === selected) ?? draft.scenes[0]!
  useEffect(() => {
    if (!active) {
      publishMessageContext?.(null)
      return
    }
    publishMessageContext?.(motionMessageContext(base, draft, dirty, scene.id))
    return () => publishMessageContext?.(null)
  }, [active, base, draft, dirty, scene.id, publishMessageContext])
  const setScene = (next: MotionScene) =>
    setDraft((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => (scene.id === next.id ? next : scene)),
    }))
  const select = (next: MotionScene, document = draft) => {
    setSelected(next.id)
    const start = document.scenes
      .slice(0, document.scenes.indexOf(next))
      .reduce((sum, scene) => sum + scene.duration, 0)
    setFrame(Math.round((start + Math.min(1, next.duration / 2)) * draft.fps))
  }
  const seek = useCallback(
    (frame: number) => {
      setFrame(frame)
      setSelected(sceneAt(draft, frame / draft.fps).scene.id)
    },
    [draft],
  )
  const patch = (next: Partial<MotionDocument>) => setDraft((draft) => ({ ...draft, ...next }))
  return (
    <div className="space-y-4" data-motion-editor>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Video title"
          value={draft.title}
          maxLength={120}
          className="flex-1"
          onChange={(event) => patch({ title: event.target.value })}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || sending || !valid.success || conflict}
          onClick={(event) => {
            if (!validateEditorNumbers(event.currentTarget)) return
            void (async () => {
              const saved = await onSave(base.revision, draft)
              if (saved) {
                setBase(saved)
                setDraft(saved.document)
              }
            })()
          }}
        >
          <Save />
          {sending ? 'Saving…' : 'Save'}
        </Button>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            disabled={sending}
            onClick={() => {
              setBase(project)
              setDraft(project.document)
            }}
          >
            Discard draft
          </Button>
        )}
        <span role="status" className="text-2xs text-text-faint">
          {dirty ? 'Unsaved changes' : 'Saved'} · revision {base.revision}
        </span>
      </div>
      {conflict && dirty && (
        <p role="alert" className="text-xs text-status-warning">
          The agent changed this video. Your draft is preserved. Export the draft as JSON before
          discarding it, then reapply the changes to the saved version.
        </p>
      )}
      {!valid.success && (
        <p role="alert" className="text-xs text-status-error">
          {valid.error.issues[0]?.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ChoiceMenu
          label={{ landscape: '16:9', portrait: '9:16', square: '1:1' }[draft.format]}
          entries={formatIds.map((format) => ({
            id: format,
            label: {
              landscape: 'Landscape · 16:9',
              portrait: 'Portrait · 9:16',
              square: 'Square · 1:1',
            }[format],
            selected: draft.format === format,
            onSelect: () => patch({ format }),
          }))}
        />
        <ChoiceMenu
          label={`Palette: ${draft.palette}`}
          entries={paletteIds.map((palette) => ({
            id: palette,
            label: palette[0]!.toUpperCase() + palette.slice(1),
            selected: draft.palette === palette,
            onSelect: () => patch({ palette }),
          }))}
        />
        <ChoiceMenu
          label={`${draft.fps} fps`}
          entries={([30, 60] as const).map((fps) => ({
            id: String(fps),
            label: `${fps} fps`,
            selected: fps === draft.fps,
            onSelect: () => patch({ fps }),
          }))}
        />
        <span className="ml-auto text-2xs tabular-nums text-text-faint">
          {draft.scenes.length} scenes · {durationOf(draft).toFixed(1)}s
        </span>
      </div>
      <div className="grid min-w-0 gap-5 @5xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <Playback document={draft} frame={frame} onFrame={seek} active={active} />
          <SceneStrip document={draft} scene={scene} onSelect={select} onChange={setDraft} />
          <ExportPanel document={draft} />
        </div>
        <div className="min-w-0 border-t border-border pt-4 @5xl:col-start-2 @5xl:row-span-2 @5xl:row-start-1 @5xl:border-l @5xl:border-t-0 @5xl:pl-5 @5xl:pt-0">
          <SceneEditor
            key={scene.id}
            scene={scene}
            assets={assets}
            onChange={setScene}
            disabled={sending}
            onUpload={onUpload}
          />
        </div>
        <div className="min-w-0 @5xl:col-start-1">
          <CollapsibleSection title="Audio & creative brief" defaultOpen={false}>
            <MediaSettings
              document={draft}
              assets={assets}
              disabled={sending}
              onChange={patch}
              onUpload={onUpload}
            />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  )
}
