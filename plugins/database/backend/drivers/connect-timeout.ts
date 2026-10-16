/**
 * How long establishing a connection may take before the driver gives up, for every network
 * engine. One number, because "Connect" on an unreachable host should fail in the same time
 * whichever engine it is — before this, Redis/Mongo gave up after 8 s while postgres.js waited
 * 30 s and SQL Server 15 s. A pasted ADO connection string keeps its own `Connect Timeout`.
 */
export const CONNECT_TIMEOUT_MS = 10_000
