import { createEventChannel } from './eventChannel'

export interface ModelPickerRequest {
  sessionId?: string
  query?: string
  providerId?: string
  connectionId?: string
  /** Open on this workload's row (`titleGeneration`, `inlineCompletion`). */
  workload?: string
}

type Listener = (request: ModelPickerRequest) => void
const channel = createEventChannel<[request: ModelPickerRequest]>()

/** Request the focused matching composer to offer its existing model picker UI. */
export function openModelPicker(request: ModelPickerRequest = {}): void {
  channel.publish(request)
}

export function subscribeModelPicker(listener: Listener): () => void {
  return channel.subscribe(listener)
}
