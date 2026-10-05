export interface ModelPickerRequest {
  sessionId?: string
  query?: string
  providerId?: string
  connectionId?: string
}

type Listener = (request: ModelPickerRequest) => void
const listeners = new Set<Listener>()

/** Request the focused matching composer to offer its existing model picker UI. */
export function openModelPicker(request: ModelPickerRequest = {}): void {
  listeners.forEach((listener) => listener(request))
}

export function subscribeModelPicker(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
