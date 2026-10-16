import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGeneratedCatalog } from "../src/generated-catalog/build.ts";
import { GeneratedCatalogRefresher, withGeneratedCatalogRefresh } from "../src/generated-catalog/refresh.ts";
import {
	AI_GATEWAY_MODELS_URL,
	fetchGeneratedCatalogDocuments,
	generatedCatalogSources,
	MODELS_DEV_API_URL,
	MODELS_DEV_DECISIONS_URL,
	NVIDIA_NIM_MODELS_URL,
	OPENROUTER_DECISION_MODELS_URL,
	OPENROUTER_IMAGE_MODELS_URL,
	OPENROUTER_MODELS_URL,
} from "../src/generated-catalog/sources.ts";
import { createModels, createProvider, type Provider } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { isModelsStoreEntry } from "../src/providers/model-entry-schema.ts";
import {
	DEFAULT_RADIUS_GATEWAY,
	getRadiusModelsFromConfig,
	loadRadiusGatewayConfig,
} from "../src/providers/radius-config.ts";
import type { AnyModel, Api, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const tool = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, tool_call: true, ...extra });

/** One small document per upstream source: enough for every converter, `--strict` included. */
const DOCUMENTS: Record<string, unknown> = {
	[MODELS_DEV_API_URL]: {
		openai: {
			models: {
				"gpt-test-1": tool("gpt-test-1", {
					name: "GPT Test 1",
					reasoning: true,
					release_date: "2026-09-01",
					reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high"] }],
					limit: { context: 400000, output: 128000 },
					cost: { input: 1, output: 8, cache_read: 0.1 },
					modalities: { input: ["text", "image"] },
				}),
			},
		},
		nvidia: { models: { "meta/llama-test": tool("meta/llama-test", { limit: { context: 128000, output: 4096 } }) } },
		"alibaba-token-plan": {
			models: Object.fromEntries(
				[
					"deepseek-v4-flash-0731",
					"deepseek-v4-pro",
					"deepseek-v4-pro-0813",
					"glm-5.2",
					"qwen3.6-flash",
					"qwen3.7-max",
					"qwen3.7-plus",
					"qwen3.8-flash",
					"qwen3.8-max",
				].map((id) => [id, tool(id)]),
			),
		},
	},
	[MODELS_DEV_DECISIONS_URL]: {
		"typesafe/jev-latest": { id: "typesafe/jev-latest", type: "decision", name: "Jev", limit: { context: 64000 } },
	},
	[NVIDIA_NIM_MODELS_URL]: { data: [{ id: "meta/llama-test" }] },
	[OPENROUTER_MODELS_URL]: {
		data: [
			{
				id: "acme/model-1",
				name: "Acme 1",
				created: 1760000000,
				supported_parameters: ["tools", "reasoning"],
				architecture: { modality: "text+image->text" },
				pricing: { prompt: "0.000001", completion: "0.000002" },
				context_length: 128000,
				top_provider: { context_length: 128000, max_completion_tokens: 16000 },
				reasoning: { supported_efforts: ["low", "medium", "high"] },
			},
		],
	},
	[OPENROUTER_IMAGE_MODELS_URL]: {
		data: [
			{
				id: "acme/image-1",
				name: "Acme Image",
				architecture: { input_modalities: ["text"], output_modalities: ["image"] },
				pricing: { prompt: "0", completion: "0" },
			},
		],
	},
	[OPENROUTER_DECISION_MODELS_URL]: { data: [] },
	[AI_GATEWAY_MODELS_URL]: {
		data: [
			{
				id: "acme/gw-1",
				name: "GW 1",
				type: "language",
				tags: ["tool-use", "reasoning"],
				context_window: 100000,
				max_tokens: 8000,
				pricing: { input: "0.000001", output: "0.000002" },
				released: 1760000000,
			},
		],
	},
	"https://radius.pi.dev/v1/config": {
		baseUrl: "https://radius.pi.dev/v1",
		models: [
			{
				id: "kimi-k3",
				name: "Kimi K3",
				reasoning: true,
				input: ["text"],
				contextWindow: 262144,
				maxTokens: 32768,
				cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
				enabled: true,
			},
		],
	},
};

interface FixtureRequest {
	url: string;
	headers: Record<string, string>;
}

/** A fetch over `DOCUMENTS`. `etags` give documents a validator; a matching If-None-Match answers 304. */
function fixtureFetch(
	options: { etags?: Record<string, string>; fail?: boolean; documents?: Record<string, unknown> } = {},
) {
	const requests: FixtureRequest[] = [];
	const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const headers = Object.fromEntries(new Headers(init?.headers).entries());
		requests.push({ url, headers });
		if (options.fail) throw new Error("offline");
		const documents = options.documents ?? DOCUMENTS;
		if (!(url in documents)) return new Response("not found", { status: 404 });
		const etag = options.etags?.[url];
		if (etag && headers["if-none-match"] === etag) return new Response(null, { status: 304 });
		return new Response(JSON.stringify(documents[url]), {
			status: 200,
			headers: { "content-type": "application/json", ...(etag ? { etag } : {}) },
		});
	};
	return { fetch: fetchImpl as typeof fetch, requests };
}

async function fixtureSources() {
	const { documents } = await fetchGeneratedCatalogDocuments({ fetch: fixtureFetch().fetch });
	return generatedCatalogSources(documents);
}

function staticProvider(id: string, models: readonly Model<Api>[]): Provider {
	return createProvider({
		id,
		auth: { apiKey: { name: "unused", resolve: async () => undefined } },
		models,
		api: { stream: () => new AssistantMessageEventStream(), streamSimple: () => new AssistantMessageEventStream() },
	});
}

function baselineModel(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-responses",
		provider,
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

describe("generated catalog conversion", () => {
	it("is the conversion generate-models writes, for the same documents", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-generated-catalog-"));
		temporaryRoots.push(root);
		const preload = join(root, "fetch.mjs");
		writeFileSync(
			preload,
			`const documents = ${JSON.stringify(DOCUMENTS)};\n` +
				"globalThis.fetch = async (input) => {\n" +
				"  const url = String(input);\n" +
				"  if (!(url in documents)) throw new Error(`Unexpected fetch: ${url}`);\n" +
				"  return new Response(JSON.stringify(documents[url]), { status: 200 });\n" +
				"};\n",
		);
		const output = join(root, "catalog");
		const run = spawnSync(
			process.execPath,
			["--import", preload, "scripts/generate-models.ts", "--strict", "--json-only", "--json-output", output],
			{ cwd: packageRoot, encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL" },
		);
		expect(run.status, run.stderr).toBe(0);
		const written = JSON.parse(readFileSync(join(output, "models.all.json"), "utf8")) as Record<string, AnyModel[]>;

		// The generator converts Radius's public config with Radius's own loader.
		vi.stubGlobal("fetch", fixtureFetch().fetch);
		const radius = getRadiusModelsFromConfig("radius", await loadRadiusGatewayConfig(DEFAULT_RADIUS_GATEWAY));
		vi.unstubAllGlobals();
		const built = buildGeneratedCatalog({ ...(await fixtureSources()), radius }, { strict: true });
		expect(built.all).toEqual(written);
		expect(written.openai.map((model) => model.id)).toContain("gpt-test-1");

		// The runtime refresh builds the same catalog; Radius refreshes through its own provider.
		const refreshed = await new GeneratedCatalogRefresher({ fetch: fixtureFetch().fetch }).load();
		const { radius: _radius, ...withoutRadius } = written;
		expect(refreshed.all).toEqual(withoutRadius);
	});

	it("builds the same catalog every time from the same documents", async () => {
		const sources = await fixtureSources();
		expect(buildGeneratedCatalog(sources, { strict: true })).toEqual(buildGeneratedCatalog(sources, { strict: true }));
	});

	it("produces entries that pi's model schema accepts", async () => {
		const catalog = buildGeneratedCatalog(await fixtureSources(), { strict: true });
		for (const models of Object.values(catalog.all)) {
			expect(isModelsStoreEntry({ models, checkedAt: 1 })).toBe(true);
		}
		expect(isModelsStoreEntry({ models: [{ ...catalog.all.openai[0], contextWindow: "big" }] })).toBe(false);
		expect(isModelsStoreEntry({ models: "none" })).toBe(false);
	});
});

describe("GeneratedCatalogRefresher", () => {
	it("revalidates documents that carried an ETag and reuses the catalog on 304", async () => {
		const etags = Object.fromEntries(Object.keys(DOCUMENTS).map((url) => [url, `"v1-${url.length}"`]));
		const { fetch, requests } = fixtureFetch({ etags });
		let now = 0;
		const refresher = new GeneratedCatalogRefresher({ fetch, now: () => now, reuseWithinMs: 10 });

		const first = await refresher.load();
		expect(requests.every((request) => request.headers["if-none-match"] === undefined)).toBe(true);

		requests.length = 0;
		now = 100;
		const second = await refresher.load();
		expect(requests.find((request) => request.url === MODELS_DEV_API_URL)?.headers["if-none-match"]).toBe(
			etags[MODELS_DEV_API_URL],
		);
		expect(second).toBe(first);
	});

	it("rebuilds when one document changed, revalidating only those with a validator", async () => {
		const { fetch, requests } = fixtureFetch({ etags: { [MODELS_DEV_API_URL]: '"md-1"' } });
		let now = 0;
		const refresher = new GeneratedCatalogRefresher({ fetch, now: () => now, reuseWithinMs: 10 });
		const first = await refresher.load();
		requests.length = 0;
		now = 100;
		const second = await refresher.load();

		const byUrl = new Map(requests.map((request) => [request.url, request.headers]));
		expect(byUrl.get(MODELS_DEV_API_URL)?.["if-none-match"]).toBe('"md-1"');
		expect(byUrl.get(OPENROUTER_MODELS_URL)?.["if-none-match"]).toBeUndefined();
		// OpenRouter has no validator, so it is fetched again and the catalog is rebuilt from both.
		expect(second).not.toBe(first);
		expect(second.all).toEqual(first.all);
	});

	it("serves concurrent and back-to-back callers from one build", async () => {
		const { fetch, requests } = fixtureFetch();
		const refresher = new GeneratedCatalogRefresher({ fetch });
		const [a, b] = await Promise.all([refresher.load(), refresher.load()]);
		const c = await refresher.load();
		expect(a).toBe(b);
		expect(c).toBe(a);
		expect(requests.filter((request) => request.url === MODELS_DEV_API_URL)).toHaveLength(1);
	});

	it("fails the build when any document fails", async () => {
		const documents = { ...DOCUMENTS };
		delete documents[AI_GATEWAY_MODELS_URL];
		const refresher = new GeneratedCatalogRefresher({ fetch: fixtureFetch({ documents }).fetch });
		await expect(refresher.load()).rejects.toThrow("Vercel AI Gateway API returned 404");
	});
});

describe("withGeneratedCatalogRefresh", () => {
	const generatedProvider = (refresher: GeneratedCatalogRefresher) =>
		withGeneratedCatalogRefresh(staticProvider("openai", [baselineModel("openai", "gpt-old")]), refresher);

	it("restores a stored catalog without network access", async () => {
		const store = new InMemoryModelsStore();
		await store.write("openai", { models: [baselineModel("openai", "gpt-stored")], checkedAt: 1 });
		const { fetch, requests } = fixtureFetch();
		const models = createModels({ modelsStore: store });
		models.setProvider(generatedProvider(new GeneratedCatalogRefresher({ fetch })));

		const result = await models.refresh({ allowNetwork: false });

		expect(result.updated).toEqual(["openai"]);
		expect(models.getModel("openai", "gpt-stored")).toBeDefined();
		expect(models.getModel("openai", "gpt-old")).toBeDefined();
		expect(requests).toHaveLength(0);
	});

	it("publishes and persists the generated models without a configured credential", async () => {
		const store = new InMemoryModelsStore();
		const models = createModels({ modelsStore: store });
		models.setProvider(generatedProvider(new GeneratedCatalogRefresher({ fetch: fixtureFetch().fetch })));

		const result = await models.refresh();

		expect(result.errors.size).toBe(0);
		expect(result.updated).toEqual(["openai"]);
		expect(models.getModel("openai", "gpt-test-1")?.releaseDate).toBe("2026-09-01");
		expect(models.getModel("openai", "gpt-old")).toBeDefined();
		const entry = await store.read("openai");
		expect(entry?.models.map((model) => model.id)).toContain("gpt-test-1");
		expect(entry?.checkedAt).toBeTypeOf("number");
	});

	it("skips the fetch while the stored catalog is fresh, unless forced", async () => {
		const store = new InMemoryModelsStore();
		await store.write("openai", { models: [], checkedAt: 1_000 });
		const { fetch, requests } = fixtureFetch();
		const models = createModels({ modelsStore: store });
		models.setProvider(
			generatedProvider(new GeneratedCatalogRefresher({ fetch, now: () => 2_000, maxAgeMs: 5_000 })),
		);

		await models.refresh();
		expect(requests).toHaveLength(0);
		expect((await store.read("openai"))?.checkedAt).toBe(1_000);

		await models.refresh({ force: true });
		expect(requests.length).toBeGreaterThan(0);
		expect(models.getModel("openai", "gpt-test-1")).toBeDefined();
	});

	it("keeps the previous list when the refresh fails", async () => {
		const store = new InMemoryModelsStore();
		await store.write("openai", { models: [baselineModel("openai", "gpt-stored")], checkedAt: 1 });
		const models = createModels({ modelsStore: store });
		models.setProvider(generatedProvider(new GeneratedCatalogRefresher({ fetch: fixtureFetch({ fail: true }).fetch })));

		const result = await models.refresh();

		expect(result.errors.get("openai")?.message).toBe("offline");
		expect(models.getModel("openai", "gpt-stored")).toBeDefined();
		expect((await store.read("openai"))?.models.map((model) => model.id)).toEqual(["gpt-stored"]);
	});
});
