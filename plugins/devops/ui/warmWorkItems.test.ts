import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('warm-hidden DevOps work items', () => {
  /**
   * The whole browser-reachable chain, not just its first two links.
   *
   * This guard used to name `resourceLink.ts` and `resource-nodes.ts` only, and the regression
   * walked straight past it: `resource-nodes.ts` later grew `import { mapKubeError } from
   * './errors'`, and THAT file imported the `./backend` barrel — which re-exports `net-safety`,
   * which reaches for `node:dns`. Vite externalizes `node:dns` to a stub that throws on first
   * property access, so importing the DevOps UI entrypoint threw, `bundledPluginUi` caught it
   * per-plugin, and the only visible symptom was a DevOps workspace missing from the rail and
   * the Capabilities panel while the plugin itself still listed as enabled.
   *
   * So the assertion follows the EDGE, not a fixed pair of files: everything the UI can reach
   * transitively is held to the browser-safe entrypoints. `check-architecture.mjs` cannot catch
   * this on its own — it flags `plugin-sdk/backend` per file, and `errors.ts` lives under
   * `backend/`, where that import is entirely legal in isolation.
   */
  test('every browser-reachable module avoids the Node-only SDK barrel', () => {
    const chain = {
      'kubernetes/ui/model/resourceLink.ts': read('../kubernetes/ui/model/resourceLink.ts'),
      'kubernetes/backend/resource-nodes.ts': read('../kubernetes/backend/resource-nodes.ts'),
      'kubernetes/backend/errors.ts': read('../kubernetes/backend/errors.ts'),
      'kubernetes/backend/contracts.ts': read('../kubernetes/backend/contracts.ts'),
      'docker/backend/errors.ts': read('../docker/backend/errors.ts'),
      'docker/backend/contracts.ts': read('../docker/backend/contracts.ts'),
      'docker/backend/bytes.ts': read('../docker/backend/bytes.ts'),
    }

    for (const [name, source] of Object.entries(chain)) {
      expect(source, `${name} is reachable from plugin UI`).not.toContain(
        "from '@localixai/plugin-sdk/backend'",
      )
    }

    expect(chain['kubernetes/ui/model/resourceLink.ts']).toContain(
      '@localixai/plugin-sdk/resource-refs',
    )
    expect(chain['kubernetes/backend/resource-nodes.ts']).toContain(
      '@localixai/plugin-sdk/resource-refs',
    )
    expect(chain['kubernetes/backend/errors.ts']).toContain('@localixai/plugin-sdk/typed-error')
    expect(chain['docker/backend/errors.ts']).toContain('@localixai/plugin-sdk/typed-error')
  })

  test('the grid host supplies its synchronous visible contract to contributed bodies', () => {
    const registry = read('../../../apps/ui/src/widgets/editor-grid/ui/registry.tsx')
    const pluginBody = read('../../../apps/ui/src/widgets/editor-grid/ui/PluginWorkItemBody.tsx')
    // The same props at every hop: a contributed kind goes registry → PluginWorkItemBody (which
    // owns the per-plugin error boundary) → the plugin's Component. A hop that drops `visible`
    // leaves a warm-hidden DevOps tab polling as if it were on screen.
    const forwarded =
      /\s+item=\{item\}\s+visible=\{visible\}\s+focused=\{focused\}\s+resolvedTheme=\{resolvedTheme\}\s+publishMessageContext=\{publishMessageContext\}\s+\/>/

    expect(registry).toContain('<WorkItemVisibilityProvider visible={props.visible}>')
    expect(registry).toMatch(new RegExp(`<PluginWorkItemBody${forwarded.source}`))
    expect(pluginBody).toMatch(new RegExp(`<Contributed${forwarded.source}`))
  })

  test('the contribution adapters forward grid visibility into every live tab', () => {
    // The adapters live beside their registration, in `register/bodies.tsx`.
    const docker = read('../docker/ui/register/bodies.tsx')
    const kubernetes = read('../kubernetes/ui/register/bodies.tsx')

    expect(docker).toMatch(
      /function DockerContainerBody\(\{\s*item,\s*visible,\s*publishMessageContext,/,
    )
    expect(docker).toContain(`<DockerContainerTab
      key={item.id}
      active={visible}`)
    // One resource adapter now serves all three kinds; they differ only by row type.
    expect(docker.match(/<DockerResourceTab\n\s+active=\{visible\}/g)).toHaveLength(1)

    expect(kubernetes).toMatch(
      /function KubernetesPodBody\(\{\s*item,\s*visible,\s*publishMessageContext,/,
    )
    expect(kubernetes).toContain(`<KubernetesPodTab
      key={item.id}
      active={visible}`)
    expect(kubernetes).toContain(`<KubernetesNodeTab
        key={item.id}
        active={visible}`)
    expect(kubernetes).toContain(`<KubernetesResourceTab
      key={item.id}
      active={visible}`)
  })

  test('hidden Docker tabs neither seed nor poll daemon state', () => {
    const containerData = read('../docker/ui/model/useDockerContainerData.ts')
    const resource = read('../docker/ui/model/useDockerResourceDetail.ts')

    expect(containerData).toContain(`if (!active) {
      immediateRefreshKeyRef.current = ''`)
    // The poll is gated on the tab first, then on whether anything can change unseen.
    expect(containerData).toMatch(/useVisiblePolling\(\{\s*enabled:\s*active &&/)
    expect(resource).toContain('if (!active || loadedTarget.current === targetKey) return')
  })

  test('hidden Kubernetes tabs release their watch and park all fetch loops', () => {
    const pod = read('../kubernetes/ui/ui/KubernetesPodTab.tsx')
    const podSeed = read('../kubernetes/ui/model/usePodTabSeed.ts')
    const podContent = read('../kubernetes/ui/model/usePodTabContent.ts')
    const podForwards = read('../kubernetes/ui/model/usePodPortForwards.ts')
    const resource = read('../kubernetes/ui/model/useKubernetesResourceTab.ts')
    const node = read('../kubernetes/ui/model/useKubernetesNodeTab.ts')

    expect(podSeed).toContain(`useEffect(() => {
    if (!active) return`)
    expect(podSeed).toContain('enabled: active && seedFailed')
    expect(podContent).toContain("enabled: active && view === 'logs' && logsLive")
    // Polled only while shown, a forward exists to die, and the stream that announces each change
    // is down (`portForwardPollNeeded`).
    expect(podForwards).toContain(
      'enabled: portForwardPollNeeded(active, forwards.length, streamLive),',
    )
    expect(podForwards).toContain('return active && forwardCount > 0')
    expect(resource.match(/if \(!active\) return/g)).toHaveLength(2)
    expect(node).toContain('if (!active || seededTarget.current === targetKey) return')
    // The pods fetch backs BOTH the pods view and the overview's reservation figure, so
    // it runs for either view — but still only while the tab is the active one.
    expect(node).toContain("if (active && (view === 'pods' || view === 'overview'))")
    // Every usage poll in the Kubernetes tabs is gated on the tab being looked at; a
    // usage loop left running in a hidden tab is exactly the leak this test guards.
    expect(pod).toContain('enabled: active && running,')
    expect(node).toContain('enabled: active && !!node,')
  })
})
