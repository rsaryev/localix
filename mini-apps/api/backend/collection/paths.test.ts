import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
  REQUEST_EXT,
  folderOf,
  normalizeRequestName,
  requestFilePath,
  requestNameFor,
} from './paths'
import { collectionRootFor } from './for-scope'

const ROOT = '/repo/.localix/api'

describe('session-owned JSON collections', () => {
  test('the already-resolved session workspace owns one direct .localix/api directory', () => {
    expect(collectionRootFor('/workspace/LOCALIX-1')).toBe('/workspace/LOCALIX-1/.localix/api')
    expect(collectionRootFor('/workspace/LOCALIX-2')).toBe('/workspace/LOCALIX-2/.localix/api')
  })
})

describe('a name is a path, and the path is the name', () => {
  test.each([
    ['users/list', 'users/list'],
    ['ping', 'ping'],
    ['a/b/c/deep', 'a/b/c/deep'],
    ['  users/list  ', 'users/list'],
    ['/users/list/', 'users/list'],
    ['users//list', 'users/list'],
    ['users\\list', 'users/list'],
    ['users/list.request.json', 'users/list'],
  ])('%p normalizes to %p', (raw, expected) => {
    expect(normalizeRequestName(raw)).toBe(expected)
  })

  test('the extension is never part of the name', () => {
    // Otherwise the logical name and either on-disk spelling could address separate requests.
    expect(normalizeRequestName('users/list')).toBe(normalizeRequestName('users/list.request.json'))
  })

  test('round-trips through the file path', () => {
    const file = requestFilePath(ROOT, 'users/list')
    expect(file).toBe(path.join(ROOT, `users/list${REQUEST_EXT}`))
    expect(requestNameFor(ROOT, file!)).toBe('users/list')
  })

  test('a plain .json file is not a request', () => {
    expect(requestNameFor(ROOT, path.join(ROOT, 'users/list.json'))).toBeNull()
  })
})

describe('names we refuse to store', () => {
  test.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['/', 'a bare separator'],
    ['..', 'traversal'],
    ['../escape', 'traversal with a tail'],
    ['users/../../etc/passwd', 'traversal in the middle'],
    ['users/./list', 'a dot segment'],
    ['.hidden', 'a hidden file'],
    ['users/.hidden', 'a hidden file in a folder'],
  ])('%p is rejected (%s)', (raw) => {
    expect(normalizeRequestName(raw)).toBeNull()
    expect(requestFilePath(ROOT, raw)).toBeNull()
  })

  test('an ABSOLUTE path cannot address a file outside the collection', () => {
    // The name is user- and model-supplied; this is the boundary, not a formatting nicety.
    const file = requestFilePath(ROOT, '/etc/passwd')
    expect(file === null || file.startsWith(ROOT)).toBe(true)
  })

  test('containment is enforced even for a name the normalizer accepted', () => {
    // Belt and braces: whatever the segment rules missed, `resolveWithin` still has to agree.
    for (const raw of ['users/list', 'a/b/c']) {
      const file = requestFilePath(ROOT, raw)
      expect(file).not.toBeNull()
      expect(file!.startsWith(`${ROOT}${path.sep}`)).toBe(true)
    }
  })
})

describe('the tree falls out of the name', () => {
  test('the folder splits at the last separator', () => {
    expect(folderOf('users/admin/list')).toBe('users/admin')
  })

  test('a request at the root has no folder', () => {
    expect(folderOf('ping')).toBe('')
  })
})

describe('reading a path back', () => {
  test('a file outside the root is not ours', () => {
    expect(requestNameFor(ROOT, '/repo/other/thing.json')).toBeNull()
    expect(requestNameFor(ROOT, '/etc/passwd.json')).toBeNull()
  })

  test('a non-request file inside the root is not ours either', () => {
    // The collection dir may hold a README or an environments folder; only request JSON counts.
    expect(requestNameFor(ROOT, path.join(ROOT, 'README.md'))).toBeNull()
  })

  test('the root itself is not a request', () => {
    expect(requestNameFor(ROOT, ROOT)).toBeNull()
  })
})
