import { binaryBytes } from '../shared/binary-value'

/**
 * Restore JSON-transported Node Buffers before native driver binding. Only top-level
 * parameter values are revived: an object nested inside a real JSON parameter stays JSON.
 */
export function reviveBinaryParams(params: unknown[] | undefined): unknown[] | undefined {
  return params?.map((value) => {
    const bytes = binaryBytes(value)
    return bytes && !(value instanceof Uint8Array) ? Buffer.from(bytes) : value
  })
}
