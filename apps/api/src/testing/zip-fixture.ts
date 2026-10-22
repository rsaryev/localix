import { deflateRawSync } from 'node:zlib'

/**
 * Build zip files byte by byte, honest or lying, for the archive-source tests: real local
 * headers, data and central directory, with the declared size, the end record's entry count and
 * ZIP64 sizes overridable per test.
 */

export interface ZipFixtureEntry {
  name: string
  data: string | Buffer
  /** Deflate the data (default) or store it. */
  deflate?: boolean
  /** The uncompressed size both headers declare, when it should not be the real one. */
  declaredBytes?: number
  /** Write the sizes as 0xFFFFFFFF with the real values in ZIP64 extra fields. */
  zip64?: boolean
}

export interface ZipFixtureOptions {
  /** The entry count the end record claims (default: the real count). */
  count?: number
}

const U32_MAX = 0xffffffff

function zip64Extra(bytes: number, compressed: number): Buffer {
  const extra = Buffer.alloc(20)
  extra.writeUInt16LE(0x0001, 0)
  extra.writeUInt16LE(16, 2)
  extra.writeBigUInt64LE(BigInt(bytes), 4)
  extra.writeBigUInt64LE(BigInt(compressed), 12)
  return extra
}

export function makeZip(entries: ZipFixtureEntry[], opts: ZipFixtureOptions = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const raw = Buffer.from(entry.data)
    const deflate = entry.deflate ?? true
    const data = deflate ? deflateRawSync(raw) : raw
    const declared = entry.declaredBytes ?? raw.length
    const name = Buffer.from(entry.name)
    const extra = entry.zip64 ? zip64Extra(declared, data.length) : Buffer.alloc(0)
    const sizeField = entry.zip64 ? U32_MAX : declared
    const compressedField = entry.zip64 ? U32_MAX : data.length
    const crc = Bun.hash.crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(entry.zip64 ? 45 : 20, 4)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressedField, 18)
    local.writeUInt32LE(sizeField, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(extra.length, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(entry.zip64 ? 45 : 20, 4)
    central.writeUInt16LE(entry.zip64 ? 45 : 20, 6)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressedField, 20)
    central.writeUInt32LE(sizeField, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(extra.length, 30)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, extra, data)
    centrals.push(central, name, extra)
    offset += local.length + name.length + extra.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const count = opts.count ?? entries.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
