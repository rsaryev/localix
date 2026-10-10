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
import { motionUri, parseMotionUri, projectIdSchema } from '../shared/contract'

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
  const id = projectIdSchema.safeParse(item.payload?.motionId)
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
      const id = projectIdSchema.safeParse(item.payload?.motionId)
      return id.success
        ? resourceMessageBindingDraft({ uri: motionUri(id.data), label: item.title })
        : null
    },
    agentContext: {
      description:
        'Motion Studio over HyperFrames compositions: each film is a folder .localix/motion/<id>/ (index.html root composition, compositions/*.html scenes, assets/, snapshots/, renders/) that the agent edits with the ordinary file tools. The view previews, reviews and renders; it does not edit scenes.',
      tools: ['motion_studio'],
      nextSteps: [
        'Create a film from the starter with motion_studio, then author it by editing its HTML files.',
        'Run check until it reports no issues; take snapshots and look at the stills to review layout and timing.',
        'Render an MP4 or WebM only when the user asks for a video file.',
      ],
    },
  })
  host.railViewlets.register({
    kind: 'motion:workspace',
    title: 'Motion Studio',
    label: 'Motion Studio — agent-made films, preview and video render',
    defaultArea: 'overflow',
    keywords: ['motion', 'video', 'animation', 'hyperframes', 'render', 'mp4'],
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
