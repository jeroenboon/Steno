/**
 * Shared handler type for the per-domain IPC handler modules (audit A2b).
 *
 * A handler takes an unknown payload, validates it with Zod, and returns the
 * result. The return is unknown at the type level; the registry's dispatch wraps
 * it in Promise.resolve(). Each per-domain module (sessionHandlers, itemHandlers,
 * …) exports a factory returning a Partial<Record<IpcChannel, Handler>>; the
 * composer in ipc-registry.ts spreads them into one map.
 */
export type Handler = (raw: unknown) => unknown
