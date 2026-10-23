import type { RequestOptions } from 'node:https'
import type * as k8s from '@kubernetes/client-node'
import { getKubernetesClient, type KubernetesClient } from './kubernetes-client'

type WatchCallback = (phase: string, apiObject: unknown, watchObject?: unknown) => void
type WatchDone = (error: unknown) => void

interface WatchError extends Error {
  statusCode?: number
}

function appendHeader(headers: Headers, name: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' || typeof item === 'number') {
        headers.append(name, String(item))
      }
    }
    return
  }
  if (typeof value === 'string' || typeof value === 'number') {
    headers.set(name, String(value))
  }
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    headers[name] = value
  })
  return headers
}

function tlsOptions(options: RequestOptions): BunFetchRequestInitTLS {
  return {
    ca: options.ca as BunFetchRequestInitTLS['ca'],
    cert: options.cert as BunFetchRequestInitTLS['cert'],
    key: options.key as BunFetchRequestInitTLS['key'],
    passphrase: options.passphrase,
    rejectUnauthorized: options.rejectUnauthorized,
    serverName: options.servername,
  }
}

/**
 * Kubernetes-authenticated fetch using Bun's native TLS implementation.
 *
 * @kubernetes/client-node's generated APIs send requests through node-fetch.
 * Under Bun, node-fetch currently drops the custom CA stored on its https.Agent.
 * Keeping kubeconfig auth and TLS in the backend transport avoids this class of
 * failure while preserving our existing typed APIs.
 */
export async function kubernetesFetch(
  config: k8s.KubeConfig,
  input: string | URL,
  init: {
    method?: string
    headers?: HeadersInit
    body?: k8s.RequestBody
    signal?: AbortSignal
  } = {},
): Promise<Response> {
  const cluster = config.getCurrentCluster()
  if (!cluster) throw new Error('No active Kubernetes cluster')

  const initialHeaders = new Headers(init.headers)
  const options: RequestOptions = {
    headers: Object.fromEntries(initialHeaders.entries()),
    method: init.method,
  }
  await config.applyToHTTPSOptions(options)

  const headers = new Headers()
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    appendHeader(headers, name, value)
  }
  if (options.auth && !headers.has('authorization')) {
    headers.set('authorization', `Basic ${Buffer.from(String(options.auth)).toString('base64')}`)
  }

  const fetchInit: BunFetchRequestInit = {
    method: init.method,
    headers,
    body: init.body as BodyInit | undefined,
    signal: init.signal,
    proxy: cluster.proxyUrl,
  }
  if (new URL(input).protocol === 'https:') fetchInit.tls = tlsOptions(options)
  return fetch(input, fetchInit)
}

class BunKubernetesHttpLibrary implements k8s.PromiseHttpLibrary {
  constructor(private readonly config: k8s.KubeConfig) {}

  async send(request: k8s.RequestContext): Promise<k8s.ResponseContext> {
    const response = await kubernetesFetch(this.config, request.getUrl(), {
      method: request.getHttpMethod(),
      headers: request.getHeaders(),
      body: request.getBody(),
      signal: request.getSignal(),
    })
    const data = response.arrayBuffer().then((value) => Buffer.from(value))
    const k8s = await getKubernetesClient()
    return new k8s.ResponseContext(
      response.status,
      responseHeaders(response),
      new k8s.SelfDecodingBody(data),
    )
  }
}

export async function createBunKubernetesConfiguration(
  config: k8s.KubeConfig,
): Promise<k8s.Configuration> {
  const cluster = config.getCurrentCluster()
  if (!cluster) throw new Error('No active Kubernetes cluster')
  const k8s = await getKubernetesClient()
  return createBunKubernetesConfigurationWithClient(k8s, config)
}

function createBunKubernetesConfigurationWithClient(
  k8s: KubernetesClient,
  config: k8s.KubeConfig,
): k8s.Configuration {
  const cluster = config.getCurrentCluster()
  if (!cluster) throw new Error('No active Kubernetes cluster')
  return k8s.createConfiguration({
    baseServer: new k8s.ServerConfiguration(cluster.server, {}),
    httpApi: k8s.wrapHttpLibrary(new BunKubernetesHttpLibrary(config)),
  })
}

type ApiConstructor<T> = new (configuration: k8s.Configuration) => T

export async function createBunApiClient<T>(
  config: k8s.KubeConfig,
  ApiClient: ApiConstructor<T>,
): Promise<T> {
  return new ApiClient(await createBunKubernetesConfiguration(config))
}

interface BunKubernetesClasses {
  BunKubernetesObjectApi: new (config: k8s.KubeConfig) => k8s.KubernetesObjectApi
  BunKubernetesWatch: new (config: k8s.KubeConfig) => k8s.Watch
}

let classesPromise: Promise<BunKubernetesClasses> | undefined

/** Build the transport subclasses once, after the heavy client has been requested. */
export function getBunKubernetesClasses(): Promise<BunKubernetesClasses> {
  return (classesPromise ??= (async () => {
    const k8s = await getKubernetesClient()

    class BunKubernetesObjectApi extends k8s.KubernetesObjectApi {
      constructor(config: k8s.KubeConfig) {
        super(createBunKubernetesConfigurationWithClient(k8s, config))
        this.setDefaultNamespace(config)
      }
    }

    /** Streaming watch equivalent of the same backend kubeconfig transport. */
    class BunKubernetesWatch extends k8s.Watch {
      override async watch(
        path: string,
        queryParams: Record<string, string | number | boolean | undefined>,
        callback: WatchCallback,
        done: WatchDone,
      ): Promise<AbortController> {
        const cluster = this.config.getCurrentCluster()
        if (!cluster) throw new Error('No active Kubernetes cluster')

        const url = new URL(cluster.server + path)
        url.searchParams.set('watch', 'true')
        for (const [key, value] of Object.entries(queryParams)) {
          if (value !== undefined) url.searchParams.set(key, String(value))
        }

        const controller = new AbortController()
        let finished = false
        const finish = (error: unknown) => {
          if (finished) return
          finished = true
          done(error)
        }

        try {
          const response = await kubernetesFetch(this.config, url, {
            method: 'GET',
            signal: controller.signal,
          })
          if (!response.ok) {
            const error = new Error(
              response.statusText || `Kubernetes watch returned ${response.status}`,
            ) as WatchError
            error.statusCode = response.status
            throw error
          }
          if (!response.body) throw new Error('Kubernetes watch returned no response body')

          const reader = response.body.getReader()
          void (async () => {
            const decoder = new TextDecoder()
            let buffered = ''
            try {
              while (true) {
                const { done: streamDone, value } = await reader.read()
                if (streamDone) break
                buffered += decoder.decode(value, { stream: true })
                const lines = buffered.split('\n')
                buffered = lines.pop() ?? ''
                for (const line of lines) {
                  if (!line.trim()) continue
                  try {
                    const frame = JSON.parse(line) as {
                      type?: unknown
                      object?: unknown
                    }
                    if (typeof frame.type === 'string') {
                      callback(frame.type, frame.object, frame)
                    }
                  } catch {
                    // A malformed frame must not terminate an otherwise healthy watch.
                  }
                }
              }
              finish(null)
            } catch (error) {
              finish(controller.signal.aborted ? null : error)
            } finally {
              reader.releaseLock()
            }
          })()
        } catch (error) {
          finish(controller.signal.aborted ? null : error)
        }

        return controller
      }
    }

    return { BunKubernetesObjectApi, BunKubernetesWatch }
  })())
}

export async function createBunObjectApi(config: k8s.KubeConfig): Promise<k8s.KubernetesObjectApi> {
  const { BunKubernetesObjectApi } = await getBunKubernetesClasses()
  return new BunKubernetesObjectApi(config)
}
