import { LOCALIX_URI_MAX_CHARS } from '../navigation'
import type {
  UiLocationParamDefinition,
  UiLocationParamSchema,
  UiLocationAgentMetadata,
} from './locations'
import {
  isRecord,
  containsAsciiControlCharacter,
  UI_LOCATION_QUERY_ENTRY_LIMIT,
  UI_LOCATION_DEFAULT_STRING_MAX,
} from './location-wire-values'

const UI_LOCATION_PARAM_KEY = /^[a-z][a-z0-9_-]{0,63}$/

/** Validate the one serializable query vocabulary shared by frontend and backend. */
export function isValidUiLocationParamSchema(schema: unknown): schema is UiLocationParamSchema {
  if (!isRecord(schema)) return false
  const entries = Object.entries(schema)
  if (entries.length > UI_LOCATION_QUERY_ENTRY_LIMIT) return false
  return entries.every(([key, rawDefinition]) => {
    if (!UI_LOCATION_PARAM_KEY.test(key) || !isRecord(rawDefinition)) return false
    const definition = rawDefinition as unknown as UiLocationParamDefinition
    const allowedKeys =
      definition.type === 'string'
        ? new Set(['type', 'description', 'optional', 'allowEmpty', 'maxLength', 'values'])
        : definition.type === 'boolean'
          ? new Set(['type', 'description', 'optional'])
          : definition.type === 'integer'
            ? new Set(['type', 'description', 'optional', 'minimum', 'maximum'])
            : definition.type === 'string-array'
              ? new Set(['type', 'description', 'optional', 'maxItems', 'maxLength'])
              : null
    if (!allowedKeys || Object.keys(rawDefinition).some((field) => !allowedKeys.has(field))) {
      return false
    }
    if (definition.optional !== undefined && typeof definition.optional !== 'boolean') return false
    if (
      definition.description !== undefined &&
      (typeof definition.description !== 'string' ||
        !definition.description.trim() ||
        definition.description.length > 240 ||
        containsAsciiControlCharacter(definition.description))
    ) {
      return false
    }
    if (definition.type === 'string') {
      if (definition.allowEmpty !== undefined && typeof definition.allowEmpty !== 'boolean') {
        return false
      }
      return (
        (definition.maxLength === undefined ||
          (Number.isInteger(definition.maxLength) &&
            definition.maxLength! > 0 &&
            definition.maxLength! <= LOCALIX_URI_MAX_CHARS)) &&
        (definition.values === undefined ||
          (Array.isArray(definition.values) &&
            definition.values.length > 0 &&
            definition.values.length <= 32 &&
            new Set(definition.values).size === definition.values.length &&
            definition.values.every(
              (value) => typeof value === 'string' && value.length > 0 && value.length <= 128,
            )))
      )
    }
    if (definition.type === 'integer') {
      if (
        (definition.minimum !== undefined && !Number.isSafeInteger(definition.minimum)) ||
        (definition.maximum !== undefined && !Number.isSafeInteger(definition.maximum))
      ) {
        return false
      }
      return (
        (definition.minimum ?? Number.MIN_SAFE_INTEGER) <=
        (definition.maximum ?? Number.MAX_SAFE_INTEGER)
      )
    }
    if (definition.type === 'string-array') {
      return (
        (definition.maxItems === undefined ||
          (Number.isInteger(definition.maxItems) &&
            definition.maxItems > 0 &&
            definition.maxItems <= UI_LOCATION_QUERY_ENTRY_LIMIT)) &&
        (definition.maxLength === undefined ||
          (Number.isInteger(definition.maxLength) &&
            definition.maxLength > 0 &&
            definition.maxLength <= UI_LOCATION_DEFAULT_STRING_MAX))
      )
    }
    return true
  })
}

export function isValidUiLocationAgentMetadata(value: unknown): value is UiLocationAgentMetadata {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => key !== 'description' && key !== 'availability')) {
    return false
  }
  return (
    typeof value.description === 'string' &&
    value.description.trim().length > 0 &&
    value.description.length <= 500 &&
    !containsAsciiControlCharacter(value.description) &&
    (value.availability === undefined ||
      value.availability === 'always' ||
      value.availability === 'runtime')
  )
}
