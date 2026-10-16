import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import type { ModelsStoreEntry } from "../models-store.ts";
import { ProviderCompatSchema } from "./compat-schema.ts";
import {
	ModelCostSchema,
	ModelInputLimitsSchema,
	ModelInputModalitySchema,
	ModelPromptCacheSchema,
	ThinkingLevelMapSchema,
} from "./model-schema.ts";

const PositiveNumber = Type.Number({ exclusiveMinimum: 0 });

const BaseModelProperties = {
	id: Type.String({ minLength: 1 }),
	name: Type.String(),
	api: Type.String({ minLength: 1 }),
	provider: Type.String({ minLength: 1 }),
	baseUrl: Type.String(),
	input: Type.Array(ModelInputModalitySchema, { minItems: 1 }),
	inputLimits: Type.Optional(ModelInputLimitsSchema),
	cost: ModelCostSchema,
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
};

/** A chat `Model` as catalogs and model stores carry it. */
export const ChatModelEntrySchema = Type.Object({
	...BaseModelProperties,
	type: Type.Optional(Type.Literal("chat")),
	reasoning: Type.Boolean(),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	promptCache: Type.Optional(ModelPromptCacheSchema),
	contextWindow: PositiveNumber,
	maxTokens: PositiveNumber,
	releaseDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
	samplingParams: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	samplingParamsByThinkingLevel: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	compat: Type.Optional(ProviderCompatSchema),
});

/** An `ImageModel` as catalogs and model stores carry it. */
export const ImageModelEntrySchema = Type.Object({
	...BaseModelProperties,
	type: Type.Literal("image"),
	output: Type.Array(ModelInputModalitySchema, { minItems: 1 }),
});

/** A `ClassifierModel` as catalogs and model stores carry it. */
export const ClassifierModelEntrySchema = Type.Object({
	...BaseModelProperties,
	type: Type.Literal("classifier"),
	contextWindow: PositiveNumber,
});

export const AnyModelEntrySchema = Type.Union([ChatModelEntrySchema, ImageModelEntrySchema, ClassifierModelEntrySchema]);

/** A persisted `ModelsStoreEntry`. */
export const ModelsStoreEntrySchema = Type.Object({
	models: Type.Array(AnyModelEntrySchema),
	lastModified: Type.Optional(Type.Number()),
	checkedAt: Type.Optional(Type.Number()),
	etag: Type.Optional(Type.String()),
});

export type ModelsStoreEntryValue = Static<typeof ModelsStoreEntrySchema>;

let entryValidator: ReturnType<typeof Compile<typeof ModelsStoreEntrySchema>> | undefined;

/**
 * Whether `value` is a well-formed `ModelsStoreEntry`. A `ModelsStore` backed by storage outside
 * the process can drop an entry that fails this check instead of handing it to a provider.
 */
export function isModelsStoreEntry(value: unknown): value is ModelsStoreEntry {
	entryValidator ??= Compile(ModelsStoreEntrySchema);
	return entryValidator.Check(value);
}
