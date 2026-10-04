/**
 * Barrel — exposes the PURE, browser-safe surface (protocol types + host payload
 * builder). The probe runtime is intentionally NOT re-exported here; it is consumed
 * only via `@localixai/visual-feedback/probe-entry` (bundled to an IIFE by the API),
 * so importing this barrel never drags DOM/probe code into a consumer bundle.
 */

export * from './protocol/index'
export * from './host/payload'
