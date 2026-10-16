/**
 * The upstream documents the generated catalog is built from, fetched for `generate-models` and for
 * a runtime refresh alike. A document fetched before is requested conditionally (`If-None-Match`,
 * `If-Modified-Since`) and a `304 Not Modified` reuses it.
 */
import type { GeneratedCatalogSources, NvidiaNimModelListItem } from "./build.ts";
import { NVIDIA_BASE_URL } from "./build.ts";
import type { OpenRouterModelListItem } from "./openrouter-catalog.ts";

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODELS_DEV_DECISIONS_URL = "https://models.dev/models.json?type=decision";
export const NVIDIA_NIM_MODELS_URL = `${NVIDIA_BASE_URL}/models`;
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_IMAGE_MODELS_URL = `${OPENROUTER_MODELS_URL}?output_modalities=image`;
export const OPENROUTER_DECISION_MODELS_URL = `${OPENROUTER_MODELS_URL}?output_modalities=decisions`;
export const AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

/** One fetched document with the validators its response carried. */
export interface SourceDocument {
	body: unknown;
	etag?: string;
	lastModified?: string;
}

export interface FetchSourceDocumentOptions {
	fetch?: typeof fetch;
	signal?: AbortSignal;
	/** The previous fetch of the same URL; its validators make the request conditional. */
	previous?: SourceDocument;
}

export interface FetchedSourceDocument {
	document: SourceDocument;
	/** The server answered 304 and `document` is `previous`. */
	notModified: boolean;
}

/** GET one JSON document. `label` names the source in the error for a non-2xx status. */
export async function fetchSourceDocument(
	url: string,
	label: string,
	options: FetchSourceDocumentOptions = {},
): Promise<FetchedSourceDocument> {
	const headers: Record<string, string> = { accept: "application/json" };
	const previous = options.previous;
	if (previous?.etag) headers["if-none-match"] = previous.etag;
	if (previous?.lastModified) headers["if-modified-since"] = previous.lastModified;
	const response = await (options.fetch ?? fetch)(url, { headers, signal: options.signal });
	if (response.status === 304 && previous) return { document: previous, notModified: true };
	if (!response.ok) throw new Error(`${label} returned ${response.status}`);
	const body: unknown = await response.json();
	const etag = response.headers.get("etag") ?? undefined;
	const lastModified = response.headers.get("last-modified") ?? undefined;
	return {
		document: { body, ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) },
		notModified: false,
	};
}

/** The documents of one catalog build, keyed by source. Radius is fetched by its own provider. */
export interface GeneratedCatalogDocuments {
	modelsDev: SourceDocument;
	modelsDevDecisions: SourceDocument;
	nvidiaNim: SourceDocument;
	openRouter: SourceDocument;
	openRouterImages: SourceDocument;
	openRouterDecisions: SourceDocument;
	aiGateway: SourceDocument;
}

export const GENERATED_CATALOG_SOURCES: Readonly<
	Record<keyof GeneratedCatalogDocuments, { url: string; label: string }>
> = {
	modelsDev: { url: MODELS_DEV_API_URL, label: "models.dev API" },
	modelsDevDecisions: { url: MODELS_DEV_DECISIONS_URL, label: "models.dev classifier API" },
	nvidiaNim: { url: NVIDIA_NIM_MODELS_URL, label: "NVIDIA NIM API" },
	openRouter: { url: OPENROUTER_MODELS_URL, label: "OpenRouter API" },
	openRouterImages: { url: OPENROUTER_IMAGE_MODELS_URL, label: "OpenRouter API" },
	openRouterDecisions: { url: OPENROUTER_DECISION_MODELS_URL, label: "OpenRouter API" },
	aiGateway: { url: AI_GATEWAY_MODELS_URL, label: "Vercel AI Gateway API" },
};

export interface FetchGeneratedCatalogDocumentsResult {
	documents: GeneratedCatalogDocuments;
	/** False when every document answered 304 against `previous`. */
	changed: boolean;
}

/** Fetch every document concurrently. Any failed document rejects the whole fetch. */
export async function fetchGeneratedCatalogDocuments(
	options: { fetch?: typeof fetch; signal?: AbortSignal; previous?: Partial<GeneratedCatalogDocuments> } = {},
): Promise<FetchGeneratedCatalogDocumentsResult> {
	const keys = Object.keys(GENERATED_CATALOG_SOURCES) as (keyof GeneratedCatalogDocuments)[];
	const fetched = await Promise.all(
		keys.map((key) =>
			fetchSourceDocument(GENERATED_CATALOG_SOURCES[key].url, GENERATED_CATALOG_SOURCES[key].label, {
				fetch: options.fetch,
				signal: options.signal,
				previous: options.previous?.[key],
			}),
		),
	);
	const documents = Object.fromEntries(keys.map((key, index) => [key, fetched[index].document]));
	return {
		documents: documents as unknown as GeneratedCatalogDocuments,
		changed: fetched.some((result) => !result.notModified),
	};
}

/** The `data` array of a listing response; anything else is an empty listing. */
export function listingItems<T>(body: unknown): T[] {
	const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
	return Array.isArray(data) ? (data as T[]) : [];
}

/** Map fetched documents onto the build's sources. */
export function generatedCatalogSources(documents: GeneratedCatalogDocuments): GeneratedCatalogSources {
	return {
		modelsDev: documents.modelsDev.body as GeneratedCatalogSources["modelsDev"],
		modelsDevDecisions: documents.modelsDevDecisions.body as GeneratedCatalogSources["modelsDevDecisions"],
		nvidiaNimModels: listingItems<NvidiaNimModelListItem>(documents.nvidiaNim.body),
		openRouter: {
			listed: listingItems<OpenRouterModelListItem>(documents.openRouter.body),
			imageListed: listingItems<OpenRouterModelListItem>(documents.openRouterImages.body),
			decisionListed: listingItems<OpenRouterModelListItem>(documents.openRouterDecisions.body),
		},
		aiGateway: documents.aiGateway.body as GeneratedCatalogSources["aiGateway"],
	};
}
