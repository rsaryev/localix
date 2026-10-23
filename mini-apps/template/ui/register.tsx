import { lazy, Suspense } from 'react'
import { MonitorCog } from 'lucide-react'
import {
  resourceMessageBindingDraft,
  type PluginUiHost,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { SYSTEM_URI } from '../shared/system'
import { LoadingHint } from '@localixai/kit/empty-hint'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

function TemplateBody({
  visible,
  publishMessageContext,
}: {
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  return (
    <Suspense fallback={<LoadingHint>Opening System Overview…</LoadingHint>}>
      <Workspace active={visible} publishMessageContext={publishMessageContext} />
    </Suspense>
  )
}

const registeredHosts = new WeakSet<PluginUiHost>()

export function registerUi(host: PluginUiHost): void {
  if (registeredHosts.has(host)) return
  registeredHosts.add(host)
  host.workItems.register({
    kind: 'template:workspace',
    Component: TemplateBody,
    Icon: MonitorCog,
    restorable: true,
    scope: 'global',
    toMessageBinding: () =>
      resourceMessageBindingDraft({ uri: SYSTEM_URI, label: 'System overview' }),
    agentContext: {
      description:
        'OS, CPU, memory, runtime and process information for the Localix backend machine. The visible snapshot includes process names, PIDs, parent PIDs and resource usage.',
      tools: ['system_overview', 'system_processes'],
      nextSteps: [
        'Use the published snapshot to explain what the user sees.',
        'Call system_overview for a fresh server snapshot; never infer that this is the browser device.',
        'Call system_processes for current process identifiers and resource usage.',
        'When the user asks to manage a process, use its PID with native system tools and apply the normal confirmation and safety rules; the plugin intentionally hardcodes no process actions.',
      ],
    },
  })
  host.railViewlets.register({
    kind: 'template:workspace',
    title: 'System Overview',
    label: 'System Overview — OS, CPU, memory & runtime',
    defaultArea: 'overflow',
    keywords: ['system', 'os', 'cpu', 'memory', 'runtime', 'bun', 'template', 'starter'],
    Icon: MonitorCog,
  })
  host.anchors.register({
    id: 'template:system-anchor',
    namespaces: ['template'],
    icons: { system: MonitorCog },
    resolve: (uri) =>
      uri === SYSTEM_URI
        ? {
            kind: 'work-item',
            workKind: 'template:workspace',
            id: 'template:workspace',
            title: 'System Overview',
          }
        : null,
  })
}
