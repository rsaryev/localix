/**
 * Store a dynamic/database-controlled key on a plain record without invoking the legacy
 * `Object.prototype.__proto__` setter. Keeping a normal Object prototype preserves the
 * shapes expected by React/DataView while making `__proto__`, `constructor`, and
 * `prototype` ordinary enumerable data keys.
 */
export function defineRecordValue<T>(record: Record<string, T>, key: string, value: T): T {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return value
}

/** Create a dictionary whose missing keys can never resolve through Object.prototype. */
export function createNullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

/** Copy enumerable own entries into a fresh null-prototype dictionary. */
export function copyNullRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.assign(createNullRecord<T>(), record)
}

/** Read only an own dynamic key; inherited Object prototype members are not record data. */
export function ownRecordValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** Return an existing own array bucket or define a fresh one safely. */
export function recordArray<T>(record: Record<string, T[]>, key: string): T[] {
  return ownRecordValue(record, key) ?? defineRecordValue(record, key, [])
}
