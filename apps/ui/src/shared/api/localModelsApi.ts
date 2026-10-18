import { client, unwrap } from './internal'
import type {
  InstallJob,
  LocalModelEntry,
  LocalModelKind,
  LocalModelsStatus,
} from '@localixai/api/client'

/** Models on this computer: catalog, downloads and what is running (`/rpc/local-models`). */
export const localModelsApi = {
  async status(): Promise<LocalModelsStatus> {
    return unwrap(await client.rpc['local-models'].status.$get())
  },
  /** The curated list, or the GGUF builds of a model added by its Hugging Face id. */
  async catalog(query: { id?: string; kind?: LocalModelKind } = {}): Promise<LocalModelEntry[]> {
    return (await unwrap(await client.rpc['local-models'].catalog.$get({ query })))
      .models as LocalModelEntry[]
  },
  /** What to get first, sized for this computer: Gemma 4 and the embedding model. */
  async recommended(): Promise<LocalModelEntry[]> {
    return (await unwrap(await client.rpc['local-models'].recommended.$get()))
      .models as LocalModelEntry[]
  },
  /** One model with its exact files (read from its repository), planned for this computer. */
  async model(id: string): Promise<LocalModelEntry | null> {
    return (await unwrap(await client.rpc['local-models'].model.$get({ query: { id } })))
      .model as LocalModelEntry | null
  },
  /** Start downloading a model (and the runtime when missing). */
  async install(modelId: string): Promise<InstallJob> {
    return (await unwrap(await client.rpc['local-models'].install.$post({ json: { modelId } })))
      .job as InstallJob
  },
  /** Stop a download and keep what it fetched; `install` resumes it. */
  async pause(modelId: string): Promise<LocalModelsStatus> {
    return unwrap(await client.rpc['local-models'].pause.$post({ json: { modelId } }))
  },
  /** Stop a download, running or paused, and delete what it fetched. */
  async cancel(modelId: string): Promise<LocalModelsStatus> {
    return unwrap(await client.rpc['local-models'].cancel.$post({ json: { modelId } }))
  },
  async remove(modelId: string): Promise<LocalModelsStatus> {
    return unwrap(await client.rpc['local-models'].remove.$post({ json: { modelId } }))
  },
}

export type { InstallJob, LocalModelEntry, LocalModelKind, LocalModelsStatus }
