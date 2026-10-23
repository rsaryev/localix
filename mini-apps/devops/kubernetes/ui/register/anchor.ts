/**
 * URI activation for `localix://resource/k8s/<ctx>/<ns>/…`: which tab (or which
 * workspace area) a Kubernetes resource reference opens. Tab ids come from
 * `watchPace` so a reference and a row open the SAME tab.
 */
import { parseLocalixResourceUri } from '@localixai/mini-app-sdk/ui'
import { podTabWorkItemId, resourceTabWorkItemId } from '../model/watchPace'
import { saveDevOpsArea } from '../../../ui/model/devopsView'

export function resolveKubernetesAnchor(id: string) {
  const parsed = parseLocalixResourceUri(id)
  if (parsed?.provider !== 'k8s') return null
  const seg = parsed.segments.map((segment) => decodeURIComponent(segment))
  if (seg[1] === 'node' && seg[2]) {
    return {
      kind: 'work-item' as const,
      workKind: 'devops:kubernetes-resource',
      id: `devops:kubernetes-node:${encodeURIComponent(seg[0] || 'current')}:${encodeURIComponent(seg[2])}`,
      title: seg[2],
      payload: {
        resourceKind: 'node',
        name: seg[2],
        namespace: '',
        context: seg[0] || undefined,
      },
    }
  }
  if (seg[1] && (seg[2] === 'deployment' || seg[2] === 'service') && seg[3]) {
    return {
      kind: 'work-item' as const,
      workKind: 'devops:kubernetes-resource',
      id: resourceTabWorkItemId(seg[2], seg[0] || undefined, seg[1], seg[3]),
      title: seg[3],
      payload: {
        resourceKind: seg[2],
        name: seg[3],
        namespace: seg[1],
        context: seg[0] || undefined,
      },
    }
  }
  if (seg.length >= 3 && seg[1] && seg[2] && seg[1] !== 'node') {
    return {
      kind: 'work-item' as const,
      workKind: 'devops:kubernetes-pod',
      id: podTabWorkItemId(seg[0] || undefined, seg[1], seg[2]),
      title: seg[2],
      payload: { podName: seg[2], namespace: seg[1], context: seg[0] || undefined },
    }
  }
  saveDevOpsArea('kubernetes')
  const kubernetesResource =
    seg[1] === 'node'
      ? 'nodes'
      : seg[2] === 'deployment'
        ? 'deployments'
        : seg[2] === 'service'
          ? 'services'
          : 'workloads'
  return {
    kind: 'work-item' as const,
    workKind: 'devops:workspace',
    id: 'devops:workspace',
    title: 'DevOps Workspace',
    payload: { area: 'kubernetes', kubernetesResource },
  }
}
