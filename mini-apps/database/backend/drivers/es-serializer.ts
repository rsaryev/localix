import JSONBig from 'json-bigint'
import { Serializer, errors } from '@elastic/elasticsearch'

/**
 * Elasticsearch returns JSON numeric tokens for `long`, `unsigned_long`, decimal source
 * values, and aggregation metrics. JavaScript's default parser rounds those before the
 * result shaper sees them, so keep long numeric tokens as exact decimal strings.
 */
const exactJson = JSONBig({
  storeAsString: true,
  // json-bigint constructs every parsed object with a null prototype. Preserve legitimate
  // database fields with these names: they remain inert own data properties and cannot
  // invoke Object.prototype setters.
  protoAction: 'preserve',
  constructorAction: 'preserve',
})

export function parseEsJsonExact(json: string): unknown {
  return exactJson.parse(json)
}

function messageOf(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return String(error)
}

/** Elastic client serializer that preserves response numbers before shaping them for the grid. */
export class ExactEsSerializer extends Serializer {
  override deserialize<T = unknown>(json: string): T {
    try {
      return parseEsJsonExact(json) as T
    } catch (error) {
      throw new errors.DeserializationError(messageOf(error), json)
    }
  }
}
