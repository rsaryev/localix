/**
 * Runtime refresh of the generated catalog: the built-in providers' models, rebuilt from the live
 * upstream documents by the same `buildGeneratedCatalog()` that `generate-models` runs, published
 * through `Models.refresh()`.
 */
import { type FetchModels, type Provider, type RefreshModelsContext, withDynamicModels } from "../models.ts";
import type { AnyModel, Api } from "../types.ts";
import { raceWithAbortSignal } from "../utils/abort.ts";
import { buildGeneratedCatalog, type GeneratedCatalog } from "./build.ts";
import {
	fetchGeneratedCatalogDocuments,
	type GeneratedCatalogDocuments,
	generatedCatalogSources,
} from "./sources.ts";

/** Six hours. */
export const DEFAULT_GENERATED_CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_REUSE_WITHIN_MS = 60_000;

export interface GeneratedCatalogRefresherOptions {
	fetch?: typeof fetch;
	/** A provider whose stored catalog was checked more recently than this is not fetched (unless forced). */
	maxAgeMs?: number;
	/** Upper bound for fetching every document of one build. */
	timeoutMs?: number;
	/**
	 * A build finished this recently serves later providers of the same `Models.refresh()`, which
	 * reach their network phase one after another.
	 */
	reuseWithinMs?: number;
	now?: () => number;
}

/**
 * Builds the generated catalog once for every provider of a refresh. A document whose response
 * carried a validator (models.dev sends an ETag) is kept in memory and requested conditionally next
 * time, so an unchanged one costs a `304`; when every document is unchanged the last catalog is
 * reused without a rebuild. Any document that fails fails the build, so a refresh never publishes
 * a catalog the generator's `--strict` run would have rejected.
 */
export class GeneratedCatalogRefresher {
	private readonly options: Required<Omit<GeneratedCatalogRefresherOptions, "fetch">> & { fetch?: typeof fetch };
	private documents: Partial<GeneratedCatalogDocuments> | undefined;
	private catalog: GeneratedCatalog | undefined;
	private builtAt: number | undefined;
	private inFlight: Promise<GeneratedCatalog> | undefined;

	constructor(options: GeneratedCatalogRefresherOptions = {}) {
		this.options = {
			fetch: options.fetch,
			maxAgeMs: options.maxAgeMs ?? DEFAULT_GENERATED_CATALOG_MAX_AGE_MS,
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			reuseWithinMs: options.reuseWithinMs ?? DEFAULT_REUSE_WITHIN_MS,
			now: options.now ?? Date.now,
		};
	}

	/** The current catalog, built from documents fetched now or within `reuseWithinMs`. */
	load(signal?: AbortSignal): Promise<GeneratedCatalog> {
		if (
			this.catalog &&
			this.builtAt !== undefined &&
			this.options.now() - this.builtAt < this.options.reuseWithinMs
		) {
			return Promise.resolve(this.catalog);
		}
		// One build serves every concurrent caller; a caller's abort stops only its own wait.
		this.inFlight ??= this.build().finally(() => {
			this.inFlight = undefined;
		});
		return signal ? raceWithAbortSignal(this.inFlight, signal) : this.inFlight;
	}

	private async build(): Promise<GeneratedCatalog> {
		const { documents, changed } = await fetchGeneratedCatalogDocuments({
			fetch: this.options.fetch,
			signal: AbortSignal.timeout(this.options.timeoutMs),
			previous: this.documents,
		});
		const catalog =
			!changed && this.catalog ? this.catalog : buildGeneratedCatalog(generatedCatalogSources(documents), { strict: true });
		// A document without a validator cannot be revalidated, so keeping it would only hold memory.
		this.documents = Object.fromEntries(
			Object.entries(documents).filter(([, document]) => document.etag || document.lastModified),
		);
		this.catalog = catalog;
		this.builtAt = this.options.now();
		return catalog;
	}

	/** `fetchModels` for one provider: its models from the current catalog. */
	fetchModels(providerId: string): (context: RefreshModelsContext) => Promise<readonly AnyModel[] | undefined> {
		return async (context) => {
			const checkedAt = context.stored?.checkedAt;
			if (!context.force && checkedAt !== undefined && this.options.now() - checkedAt < this.options.maxAgeMs) {
				return undefined;
			}
			const catalog = await this.load(context.signal);
			return catalog.all[providerId] ?? [];
		};
	}
}

/**
 * Makes a built-in provider refresh its generated models from `refresher`. The catalog is public,
 * so the provider refreshes without a configured credential.
 */
export function withGeneratedCatalogRefresh<TApi extends Api>(
	provider: Provider<TApi>,
	refresher: GeneratedCatalogRefresher,
): Provider<TApi> {
	return withDynamicModels(provider, {
		// The catalog holds this provider's generated models, whose APIs are the provider's own.
		fetchModels: refresher.fetchModels(provider.id) as FetchModels<TApi>,
		refreshWithoutAuth: true,
	});
}
