import { MAX_COLLECTION_NAME_LENGTH, MAX_METADATA_FIELD_LENGTH } from './library-state'

function cleanPresentationField(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\s+/gu, ' ').trim()
  return clean ? clean.slice(0, limit) : undefined
}

export function metadataField(value: string, label: string, allowEmpty = false): string {
  const clean = cleanPresentationField(value, MAX_METADATA_FIELD_LENGTH + 1)
  if (!clean) {
    if (allowEmpty) return ''
    throw new Error(`${label} cannot be empty`)
  }
  if (clean.length > MAX_METADATA_FIELD_LENGTH) {
    throw new Error(`${label} must be ${MAX_METADATA_FIELD_LENGTH} characters or fewer`)
  }
  return clean
}

export function collectionName(value: string): string {
  const clean = cleanPresentationField(value, MAX_COLLECTION_NAME_LENGTH + 1)
  if (!clean) throw new Error('Collection name cannot be empty')
  if (clean.length > MAX_COLLECTION_NAME_LENGTH) {
    throw new Error(`Collection name must be ${MAX_COLLECTION_NAME_LENGTH} characters or fewer`)
  }
  return clean
}
