import { describe, expect, test } from 'bun:test'
import { getBunKubernetesClasses } from './api-http'
import { getKubernetesClient } from './kubernetes-client'

describe('Kubernetes client lazy loader', () => {
  test('shares one in-flight import across concurrent first use', async () => {
    const first = getKubernetesClient()
    const second = getKubernetesClient()

    expect(second).toBe(first)
    const [firstClient, secondClient] = await Promise.all([first, second])
    expect(secondClient).toBe(firstClient)
  })

  test('builds the transport subclasses once with their behavior on the prototype', async () => {
    const first = getBunKubernetesClasses()
    const second = getBunKubernetesClasses()

    expect(second).toBe(first)
    const [{ BunKubernetesObjectApi, BunKubernetesWatch }, k8s] = await Promise.all([
      first,
      getKubernetesClient(),
    ])
    const config = new k8s.KubeConfig()
    config.loadFromOptions({
      clusters: [{ name: 'cluster', server: 'https://cluster.example' }],
      users: [{ name: 'user' }],
      contexts: [{ name: 'context', cluster: 'cluster', user: 'user', namespace: 'measured' }],
      currentContext: 'context',
    })

    const objectApi = new BunKubernetesObjectApi(config)
    const watch = new BunKubernetesWatch(config)
    expect(objectApi).toBeInstanceOf(k8s.KubernetesObjectApi)
    expect(Reflect.get(objectApi, 'defaultNamespace')).toBe('measured')
    expect(watch).toBeInstanceOf(k8s.Watch)
    expect(Object.hasOwn(watch, 'watch')).toBe(false)
    expect(Object.hasOwn(Object.getPrototypeOf(watch), 'watch')).toBe(true)
  })
})
