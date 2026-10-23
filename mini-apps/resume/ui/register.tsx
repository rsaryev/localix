import { lazy, Suspense } from 'react'
import { FileText } from 'lucide-react'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import {
  resourceMessageBindingDraft,
  type MiniAppUiHost,
  type PublishMessageContext,
  type WorkItemLike,
} from '@localixai/mini-app-sdk/ui'
import { parseResumeUri, resumeUri } from '../shared/resource-uri'
import { idSchema } from '../shared/schema'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)
function ResumeBody({
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
    return <EmptyHint>Reopen Resumes from a conversation to use its workspace.</EmptyHint>
  const id = idSchema.safeParse(item.payload?.resumeId)
  const section = idSchema.safeParse(item.payload?.sectionId)
  return (
    <Suspense fallback={<LoadingHint>Opening resumes…</LoadingHint>}>
      <Workspace
        active={visible}
        sessionId={sessionId}
        initialId={id.success ? id.data : undefined}
        initialSectionId={section.success ? section.data : undefined}
        publishMessageContext={publishMessageContext}
      />
    </Suspense>
  )
}
const registered = new WeakSet<MiniAppUiHost>()
export function registerUi(host: MiniAppUiHost): void {
  if (registered.has(host)) return
  registered.add(host)
  host.workItems.register({
    kind: 'resume:workspace',
    Component: ResumeBody,
    Icon: FileText,
    restorable: true,
    scope: 'session',
    toMessageBinding: (item) => {
      const id = idSchema.safeParse(item.payload?.resumeId)
      const section = idSchema.safeParse(item.payload?.sectionId)
      return id.success
        ? resourceMessageBindingDraft({
            uri: resumeUri(id.data, section.success ? section.data : undefined),
            label: item.title,
          })
        : null
    },
    agentContext: {
      description:
        'Structured resume editor with a saved revision and explicitly labeled unsaved draft context. Identity, sections and role context share one core model.',
      tools: ['resume'],
      nextSteps: [
        'Create with one resume init carrying the whole content as document; to edit an existing resume, get its ids and revision, then update.',
        'Use duplicate for an independent role variant; update only intended fields and preserve intervening changes.',
        'Read source files with existing tools. Draft snapshots are evidence; do not invent qualifications or overwrite saved state from a stale draft.',
      ],
    },
  })
  host.railViewlets.register({
    kind: 'resume:workspace',
    title: 'Resumes',
    label: 'Resumes — structured editor and agent context',
    defaultArea: 'overflow',
    keywords: ['resume', 'cv', 'career', 'experience'],
    Icon: FileText,
  })
  host.anchors.register({
    id: 'resume:anchor',
    namespaces: ['resume'],
    icons: { resume: FileText },
    resolve: (uri) => {
      const target = parseResumeUri(uri)
      return target
        ? {
            kind: 'work-item',
            workKind: 'resume:workspace',
            id: `resume:${target.id}${target.sectionId ? `:${target.sectionId}` : ''}`,
            title: 'Resume',
            payload: {
              resumeId: target.id,
              ...(target.sectionId ? { sectionId: target.sectionId } : {}),
            },
          }
        : null
    },
  })
}
