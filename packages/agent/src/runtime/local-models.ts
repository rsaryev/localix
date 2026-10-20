/**
 * LOCAL MODELS: chat models running on this computer behind an OpenAI-compatible server the HOST
 * manages. An engine lists them as the `local` provider and streams them like any other; it sees
 * only this narrow port, never how the server is run.
 */
export const LOCAL_PROVIDER_ID = 'local'

export interface LocalChatModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  vision: boolean
  /** Its chat template can think before answering; the picker then offers reasoning levels. */
  reasoning: boolean
}

export interface LocalProviderHost {
  /** Installed and downloadable chat models. Called on every list; keep it cheap. */
  models(): readonly LocalChatModel[]
  isInstalled(modelId: string): boolean
  /**
   * Resolve once the model is on this computer (waiting out a download in progress); reject
   * with a sentence a person can act on when it is not coming (paused, failed, never asked).
   */
  whenReady(modelId: string, signal?: AbortSignal): Promise<void>
  /** The running server (started when needed). Rejects with a sentence a person can act on. */
  endpoint(signal: AbortSignal): Promise<{ baseUrl: string; apiKey: string }>
}
