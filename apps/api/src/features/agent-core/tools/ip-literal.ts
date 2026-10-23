/**
 * Compatibility seam for host modules. The implementation is owned by the backend SDK so
 * built-ins and plugins parse address literals identically.
 */
export { embeddedV4, ipv6ToBytes } from '@localixai/mini-app-sdk/backend'
