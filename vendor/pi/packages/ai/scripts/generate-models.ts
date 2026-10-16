#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
	buildGeneratedCatalog,
	type GeneratedCatalogSources,
	type NvidiaNimModelListItem,
} from "../src/generated-catalog/build.ts";
import type { OpenRouterModelListItem } from "../src/generated-catalog/openrouter-catalog.ts";
import {
	fetchSourceDocument,
	GENERATED_CATALOG_SOURCES,
	type GeneratedCatalogDocuments,
	listingItems,
} from "../src/generated-catalog/sources.ts";
import type { AnyModel, Model } from "../src/types.ts";
import {
	createModelDataManifest,
	groupProviderModelData,
	type ModelDataStructure,
	MODEL_DATA_MANIFEST_FILE,
	readModelDataProviderIds,
	validateGeneratedModelData,
	validateModelDataDirectory,
} from "./model-data.ts";
import {
	DEFAULT_RADIUS_GATEWAY,
	getRadiusModelsFromConfig,
	loadRadiusGatewayConfig,
} from "../src/providers/radius-config.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

function readGeneratorOptions(args: string[]): {
	strict: boolean;
	dataOnly: boolean;
	jsonOnly: boolean;
	jsonOutputDir: string | undefined;
	pretty: boolean;
} {
	let strict = false;
	let dataOnly = false;
	let jsonOnly = false;
	let jsonOutputDir: string | undefined;
	let pretty = false;

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--strict") {
			strict = true;
			continue;
		}
		if (arg === "--data-only") {
			dataOnly = true;
			continue;
		}
		if (arg === "--json-only") {
			jsonOnly = true;
			continue;
		}
		if (arg === "--pretty") {
			pretty = true;
			continue;
		}
		if (arg === "--json-output") {
			const value = args[++index];
			if (!value) throw new Error("--json-output requires a directory");
			jsonOutputDir = resolve(value);
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	if (jsonOnly && !jsonOutputDir) throw new Error("--json-only requires --json-output");
	if (dataOnly && (jsonOnly || jsonOutputDir)) throw new Error("--data-only cannot be combined with JSON catalog output");
	return { strict, dataOnly, jsonOnly, jsonOutputDir, pretty };
}

const generatorOptions = readGeneratorOptions(process.argv.slice(2));

/**
 * Fetch one upstream document. A failure is reported; with `--strict` it fails the run, otherwise
 * the source is left out of the catalog.
 */
async function fetchDocument(source: keyof GeneratedCatalogDocuments, failure: string): Promise<unknown> {
	const { url, label } = GENERATED_CATALOG_SOURCES[source];
	try {
		return (await fetchSourceDocument(url, label)).document.body;
	} catch (error) {
		console.error(failure, error);
		if (generatorOptions.strict) throw error;
		return undefined;
	}
}

async function fetchOpenRouterListings(): Promise<GeneratedCatalogSources["openRouter"]> {
	try {
		console.log("Fetching models from OpenRouter API...");
		const [listed, imageListed, decisionListed] = await Promise.all(
			(["openRouter", "openRouterImages", "openRouterDecisions"] as const).map(async (source) =>
				listingItems<OpenRouterModelListItem>(
					(await fetchSourceDocument(GENERATED_CATALOG_SOURCES[source].url, GENERATED_CATALOG_SOURCES[source].label))
						.document.body,
				),
			),
		);
		return { listed, imageListed, decisionListed };
	} catch (error) {
		console.error("Failed to fetch OpenRouter models:", error);
		if (generatorOptions.strict) throw error;
		return undefined;
	}
}

async function fetchRadiusModels(): Promise<Model<"pi-messages">[]> {
	try {
		console.log("Fetching models from Radius API...");
		const config = await loadRadiusGatewayConfig(DEFAULT_RADIUS_GATEWAY);
		const models = getRadiusModelsFromConfig("radius", config);
		if (models.length === 0) throw new Error("Radius API returned no models");
		console.log(`Fetched ${models.length} models from Radius`);
		return models;
	} catch (error) {
		console.error("Failed to fetch Radius models:", error);
		if (generatorOptions.strict) throw error;
		return [];
	}
}

async function generateModels() {
	// Fetch models from all upstream catalogs.
	// models.dev: Anthropic, Google, OpenAI, Groq, Cerebras, and others
	// OpenRouter: its tool-capable routed catalog
	// AI Gateway: OpenAI-compatible catalog with tool-capable models
	// Radius: its unauthenticated public catalog; authenticated clients overlay it at runtime
	console.log("Fetching models from models.dev API...");
	const modelsDev = (await fetchDocument("modelsDev", "Failed to load models.dev data:")) as
		| GeneratedCatalogSources["modelsDev"]
		| undefined;
	let nvidiaNimModels: NvidiaNimModelListItem[] | undefined;
	if (modelsDev?.nvidia?.models) {
		console.log("Fetching models from NVIDIA NIM API...");
		nvidiaNimModels = listingItems<NvidiaNimModelListItem>(
			await fetchDocument("nvidiaNim", "Failed to fetch NVIDIA NIM models:"),
		);
		console.log(`Fetched ${nvidiaNimModels.length} model IDs from NVIDIA NIM`);
	}
	console.log("Fetching classifier models from models.dev API...");
	const modelsDevDecisions = (await fetchDocument(
		"modelsDevDecisions",
		"Failed to load models.dev classifier data:",
	)) as GeneratedCatalogSources["modelsDevDecisions"];
	const openRouter = await fetchOpenRouterListings();
	console.log("Fetching models from Vercel AI Gateway API...");
	const aiGateway = (await fetchDocument("aiGateway", "Failed to fetch Vercel AI Gateway models:")) as
		| GeneratedCatalogSources["aiGateway"]
		| undefined;
	const radius = await fetchRadiusModels();

	// The conversion is shared with the runtime catalog refresh (src/generated-catalog/).
	const catalog = buildGeneratedCatalog(
		{ modelsDev, modelsDevDecisions, nvidiaNimModels, openRouter, aiGateway, radius },
		{ strict: generatorOptions.strict, logger: { log: console.log, error: console.error } },
	);
	const sortedProviderIds = catalog.providerIds;
	const jsonChatProviders = catalog.chat;
	const jsonAllProviders: Record<string, AnyModel[]> = catalog.all;

	const serializeJson = (value: unknown) => `${JSON.stringify(value, null, generatorOptions.pretty ? 2 : undefined)}\n`;
	const writeJson = (path: string, value: unknown) => writeFileSync(path, serializeJson(value));
	const generatedDataProviderIds = generatorOptions.dataOnly
		? readModelDataProviderIds(packageRoot)
		: sortedProviderIds;
	const missingProviderIds = generatedDataProviderIds.filter((providerId) => !jsonAllProviders[providerId]);
	if (missingProviderIds.length > 0) {
		throw new Error(`Cannot hydrate missing providers: ${missingProviderIds.join(", ")}`);
	}

	// Only the ignored internal data is grouped by API for type derivation.
	const generatedDataProviders: Record<string, Record<string, Record<string, AnyModel>>> = {};
	const modelDataStructure: ModelDataStructure = {};
	for (const providerId of generatedDataProviderIds) {
		const { groups, structure } = groupProviderModelData(providerId, jsonAllProviders[providerId]);
		generatedDataProviders[providerId] = groups;
		modelDataStructure[providerId] = structure;
	}

	const generatedAt = new Date().toISOString();

	if (!generatorOptions.jsonOnly) {
		// Stage and validate all provider values before replacing the current generated data.
		const providersDir = join(packageRoot, "src/providers");
		const dataDir = join(providersDir, "data");
		const stagingRoot = mkdtempSync(join(providersDir, ".model-generation-"));
		const stagedDataDir = join(stagingRoot, "data");
		const previousDataDir = join(stagingRoot, "previous-data");
		let restoreGeneratedCatalog: (() => void) | undefined;
		try {
			mkdirSync(stagedDataDir, { recursive: true });
			const fileContents: Record<string, string> = {};
			for (const providerId of generatedDataProviderIds) {
				const filename = `${providerId}.json`;
				const content = serializeJson(generatedDataProviders[providerId]);
				fileContents[filename] = content;
				writeFileSync(join(stagedDataDir, filename), content);
			}
			writeJson(
				join(stagedDataDir, MODEL_DATA_MANIFEST_FILE),
				createModelDataManifest(modelDataStructure, fileContents, generatedAt),
			);
			validateModelDataDirectory(modelDataStructure, stagedDataDir);

			if (!generatorOptions.dataOnly) {
				const previousShardContents = new Map(
					readdirSync(providersDir)
						.filter((entry) => entry.endsWith(".models.ts"))
						.map((entry) => [entry, readFileSync(join(providersDir, entry), "utf8")] as const),
				);
				const aggregatorPath = join(packageRoot, "src/models.generated.ts");
				const previousAggregator = readFileSync(aggregatorPath, "utf8");
				restoreGeneratedCatalog = () => {
					for (const entry of readdirSync(providersDir)) {
						if (entry.endsWith(".models.ts")) rmSync(join(providersDir, entry));
					}
					for (const [entry, content] of previousShardContents) {
						writeFileSync(join(providersDir, entry), content);
					}
					writeFileSync(aggregatorPath, previousAggregator);
				};

				const generatedHeader = `// This file is auto-generated by scripts/generate-models.ts
// Do not edit manually - run 'npm run generate-models' to update

`;
				const catalogConstName = (providerId: string) =>
					`${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_MODELS`;
				const imageCatalogConstName = (providerId: string) =>
					`${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_IMAGE_MODELS`;
				const classifierCatalogConstName = (providerId: string) =>
					`${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CLASSIFIER_MODELS`;
				const generatedShardFiles = new Set<string>();
				for (const providerId of sortedProviderIds) {
					let output = generatedHeader;
					output += `import values from "./data/${providerId}.json" with { type: "json" };\n`;
					output += `import { flattenChatModelCatalog, flattenClassifierModelCatalog, flattenImageModelCatalog, type ChatModelCatalog, type ClassifierModelCatalog, type ImageModelCatalog } from "../model-catalog.ts";\n\n`;
					output += `export const ${catalogConstName(providerId)}: ChatModelCatalog<typeof values, ${JSON.stringify(providerId)}> =\n`;
					output += `\tflattenChatModelCatalog(${JSON.stringify(providerId)}, values);\n\n`;
					output += `export const ${imageCatalogConstName(providerId)}: ImageModelCatalog<typeof values, ${JSON.stringify(providerId)}> =\n`;
					output += `\tflattenImageModelCatalog(${JSON.stringify(providerId)}, values);\n\n`;
					output += `export const ${classifierCatalogConstName(providerId)}: ClassifierModelCatalog<typeof values, ${JSON.stringify(providerId)}> =\n`;
					output += `\tflattenClassifierModelCatalog(${JSON.stringify(providerId)}, values);\n`;
					const filename = `${providerId}.models.ts`;
					generatedShardFiles.add(filename);
					writeFileSync(join(providersDir, filename), output);
				}
				for (const entry of readdirSync(providersDir)) {
					if (entry.endsWith(".models.ts") && !generatedShardFiles.has(entry)) rmSync(join(providersDir, entry));
				}

				let output = generatedHeader;
				for (const providerId of sortedProviderIds) {
					output += `import { ${classifierCatalogConstName(providerId)}, ${imageCatalogConstName(providerId)}, ${catalogConstName(providerId)} } from "./providers/${providerId}.models.ts";\n`;
				}
				output += `\nexport const MODELS: {\n`;
				for (const providerId of sortedProviderIds) {
					output += `\treadonly ${JSON.stringify(providerId)}: typeof ${catalogConstName(providerId)};\n`;
				}
				output += `} = {\n`;
				for (const providerId of sortedProviderIds) {
					output += `\t${JSON.stringify(providerId)}: ${catalogConstName(providerId)},\n`;
				}
				output += `};\n\nexport const IMAGE_MODELS: {\n`;
				for (const providerId of sortedProviderIds) {
					output += `\treadonly ${JSON.stringify(providerId)}: typeof ${imageCatalogConstName(providerId)};\n`;
				}
				output += `} = {\n`;
				for (const providerId of sortedProviderIds) {
					output += `\t${JSON.stringify(providerId)}: ${imageCatalogConstName(providerId)},\n`;
				}
				output += `};\n\nexport const CLASSIFIER_MODELS: {\n`;
				for (const providerId of sortedProviderIds) {
					output += `\treadonly ${JSON.stringify(providerId)}: typeof ${classifierCatalogConstName(providerId)};\n`;
				}
				output += `} = {\n`;
				for (const providerId of sortedProviderIds) {
					output += `\t${JSON.stringify(providerId)}: ${classifierCatalogConstName(providerId)},\n`;
				}
				output += `};\n`;
				writeFileSync(aggregatorPath, output);
				console.log("Generated provider catalogs and src/models.generated.ts");
			}

			const hadPreviousData = existsSync(dataDir);
			if (hadPreviousData) renameSync(dataDir, previousDataDir);
			try {
				renameSync(stagedDataDir, dataDir);
				validateGeneratedModelData(packageRoot);
			} catch (error) {
				rmSync(dataDir, { recursive: true, force: true });
				if (hadPreviousData && existsSync(previousDataDir)) renameSync(previousDataDir, dataDir);
				throw error;
			}
			restoreGeneratedCatalog = undefined;
			console.log(
				generatorOptions.dataOnly
					? "Hydrated JSON model values under src/providers/data/"
					: "Generated JSON model values under src/providers/data/",
			);
		} catch (error) {
			restoreGeneratedCatalog?.();
			throw error;
		} finally {
			rmSync(stagingRoot, { recursive: true, force: true });
		}
	}

	if (generatorOptions.jsonOutputDir) {
		// `models.json` and `providers/{id}.json` retain the legacy keyed chat catalog.
		// The `.all` variants are arrays so the same upstream id can appear once per type.
		const providerOutputDir = join(generatorOptions.jsonOutputDir, "providers");
		rmSync(generatorOptions.jsonOutputDir, { recursive: true, force: true });
		mkdirSync(providerOutputDir, { recursive: true });
		writeJson(join(generatorOptions.jsonOutputDir, "models.json"), jsonChatProviders);
		writeJson(join(generatorOptions.jsonOutputDir, "models.all.json"), jsonAllProviders);
		writeJson(join(generatorOptions.jsonOutputDir, "providers.json"), sortedProviderIds);
		for (const providerId of sortedProviderIds) {
			writeJson(join(providerOutputDir, `${providerId}.json`), jsonChatProviders[providerId]);
			writeJson(join(providerOutputDir, `${providerId}.all.json`), jsonAllProviders[providerId]);
		}
		console.log(`Generated JSON model catalog under ${generatorOptions.jsonOutputDir}`);
	}

	// Print statistics
	const chatModels: Model<any>[] = sortedProviderIds.flatMap((providerId) => Object.values(catalog.chat[providerId]));
	const totalModels = chatModels.length;
	const reasoningModels = chatModels.filter((model) => model.reasoning).length;

	console.log(`\nModel Statistics:`);
	console.log(`  Total tool-capable models: ${totalModels}`);
	console.log(`  Reasoning-capable models: ${reasoningModels}`);

	for (const providerId of sortedProviderIds) {
		console.log(
			`  ${providerId}: ${Object.keys(catalog.chat[providerId]).length} chat models, ${Object.keys(catalog.image[providerId]).length} image models, ${Object.keys(catalog.classifier[providerId]).length} classifier models`,
		);
	}
}

// Run the generator
generateModels().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
