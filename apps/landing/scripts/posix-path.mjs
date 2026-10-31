import path from 'node:path'

/** A platform path as a forward-slash path, the form manifests and links use. */
export const toPosix = (value) => value.split(path.sep).join('/')
