interface PlaceholderState {
  hasConnection: boolean
  hasModel: boolean
  readOnlyReason?: string | null
  isGenerating: boolean
}

/** What the empty composer says: the first missing prerequisite, else what typing will do. */
export function composerPlaceholder({
  hasConnection,
  hasModel,
  readOnlyReason,
  isGenerating,
}: PlaceholderState): string {
  if (!hasConnection) return 'Connect a provider in the app to start…'
  if (!hasModel) return 'Select a model to start…'
  if (readOnlyReason) return readOnlyReason
  return isGenerating ? 'Type a message to queue…' : 'Describe the outcome you want…'
}
