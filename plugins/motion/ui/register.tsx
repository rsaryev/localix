import { lazy, Suspense } from 'react'
import { Film } from 'lucide-react'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import {
  resourceMessageBindingDraft,
  type PluginUiHost,
  type PublishMessageContext,
  type WorkItemLike,
} from '@localixai/plugin-sdk/ui'
import { idSchema } from '../shared/schema'
import { motionUri, parseMotionUri } from '../shared/resource-uri'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)
function MotionBody({
  item,
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId)
    return <EmptyHint>Reopen Motion Studio from a conversation to use its workspace.</EmptyHint>
  const id = idSchema.safeParse(item.payload?.motionId)
  return (
    <Suspense fallback={<LoadingHint>Opening Motion Studio…</LoadingHint>}>
      <Workspace
        active={visible}
        sessionId={sessionId}
        initialId={id.success ? id.data : undefined}
        publishMessageContext={publishMessageContext}
      />
    </Suspense>
  )
}
const registered = new WeakSet<PluginUiHost>()
export function registerUi(host: PluginUiHost): void {
  if (registered.has(host)) return
  registered.add(host)
  host.workItems.register({
    kind: 'motion:workspace',
    Component: MotionBody,
    Icon: Film,
    restorable: true,
    scope: 'session',
    toMessageBinding: (item) => {
      const id = idSchema.safeParse(item.payload?.motionId)
      return id.success
        ? resourceMessageBindingDraft({ uri: motionUri(id.data), label: item.title })
        : null
    },
    agentContext: {
      description:
        'Motion video editor with shared scene data, templates, image/audio assets, revision-safe authoring and local MP4/WebM export.',
      tools: ['motion_studio'],
      nextSteps: [
        'Call guide before authoring. create accepts a template or a complete document.',
        'Read the current revision before update. Preserve intervening user edits on conflict.',
        'Use the creative brief and supplied evidence; review readability, timing and the end card.',
        'Unsaved drafts are visible evidence. Export is performed in the workbench; authoring alone does not create an MP4.',
      ],
    },
  })
  host.railViewlets.register({
    kind: 'motion:workspace',
    title: 'Motion Studio',
    label: 'Motion Studio — templates, scenes and video export',
    defaultArea: 'overflow',
    keywords: ['motion', 'video', 'animation', 'templates', 'render', 'mp4'],
    Icon: Film,
  })
  host.anchors.register({
    id: 'motion:anchor',
    namespaces: ['motion'],
    icons: { motion: Film },
    resolve: (uri) => {
      const id = parseMotionUri(uri)
      return id
        ? {
            kind: 'work-item',
            workKind: 'motion:workspace',
            id: `motion:${id}`,
            title: 'Motion Studio',
            payload: { motionId: id },
          }
        : null
    },
  })
}
