# Local models

Local models run on this computer: open chat models you can pick for any agent, and the embedding
model behind [semantic search](semantic-search.md). Nothing you send them leaves the computer, and
they cost nothing per token.

**Availability:** macOS (Apple silicon and Intel), Linux and Windows on x64 or arm64. Models are
downloaded from Hugging Face the first time you ask for one.

## What you can do

| Capability                 | Mechanism                                                                                                                                                                 | Boundary                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Start with the recommended | **Settings → Models → Local → Get models** lists Gemma 4 first, ranked for this computer by the **Fastest … Smartest** slider (Balanced by default), and EmbeddingGemma 2 | Balanced keeps room for the rest of the computer; Smarter and Smartest allow a tighter fit |
| Browse models              | Below the recommended, the same list holds the labs' most downloaded models (Qwen, Gemma, Llama, Mistral…), newest first                                                  | Fine-tunes and merges are not listed; add them by id                                       |
| See how a model runs here  | Each row says its size, whether it fits this computer's memory and about how fast it answers                                                                              | Speed is an estimate from memory bandwidth, not a benchmark                                |
| Add any other model        | Paste its Hugging Face id (`Qwen/Qwen3.8-Flash-Next`) into the list's field — chat or embedding models alike; **Browse Hugging Face** opens the GGUF models there         | An original model's id finds its GGUF builds; trusted converters first                     |
| Download a model           | **Download**; progress, pause, resume and cancel in its row and above the composer                                                                                        | One download at a time; a download cut by quitting resumes at next start                   |
| Use a model in a chat      | Connect **Local** in the model picker (no key); the downloaded models are listed there                                                                                    | A message sent while its model downloads is answered once it is here                       |
| Remove a model             | **Remove** in its row under **On this computer** or the picker's model details                                                                                            | Chats using it say it is not downloaded. EmbeddingGemma 2 is built in and stays            |

## How it works

The list is one Hugging Face request, cached for six hours: the most downloaded GGUF repositories,
kept to the labs' own models — published by the lab, or converted by the llama.cpp project, unsloth,
LM Studio or bartowski — with the build that runs best on this computer for each. Sizes come from
each model's parameter count until its files are read; downloading always uses the exact files.

The recommendation is Gemma 4, the model Localix is tuned on, in every size and width that fits this
computer: Google's quantization-aware Q4_0 builds and the trusted converters' Q3 to Q8 quantizations
of the same originals. Each is scored for intelligence (its size within the family), speed (expected
tokens per second, saturating near 40) and fidelity (how much of the original its width keeps).
Memory is a filter, not a score.

The slider weighs speed against intelligence. A model that fits only tightly loses to a comfortable
one at Balanced and barely matters at Smartest; the position is remembered in this browser. On a 24
GB Mac, Balanced picks Gemma 4 12B and Smartest the 26B-A4B mixture of experts at Q3.

The model picker lists a local chat model for agents once one is installed.

EmbeddingGemma 2 is built in: Localix downloads it quietly on first start and keeps it — its row
says **Built in**, and it can be paused but not cancelled or removed. Semantic search, group routing
and mini apps use it from the list of installed models; none of them owns its download.

Every model is pinned to the Hugging Face commit it was listed at, and each file is checked against
its published SHA-256 before it counts as installed. An interrupted download is never mistaken for a
complete one.

The models run on llama.cpp's `llama-server`, downloaded with the first model and pinned to one
release. One server process serves every local model: it starts on the first request, loads the
model a request names, keeps at most two loaded (a chat model beside the embedding model), and stops
after 15 idle minutes. It listens on this computer's loopback address only and accepts requests only
with a key generated for each start.

Each model is planned for this computer: the context it is started with (up to 64K tokens), and the
attention cache's type — f16, or q8_0 when only that fits. Models whose template can think offer
reasoning levels. Models with a published draft model (Gemma 4) download it too and answer faster.

## Configuration

| Item           | Location or value                           |
| -------------- | ------------------------------------------- |
| Models         | `~/.localix/models/models/<model>`          |
| Runtime        | `~/.localix/models/runtime/<llama.cpp tag>` |
| Server presets | `~/.localix/models/router/presets.ini`      |
| Runtime build  | llama.cpp b11600 (CPU and Metal builds)     |
| `HF_TOKEN`     | Optional: higher Hugging Face rate limits   |

## Limits

- Linux and Windows use the CPU build; a fast GPU is not used yet. On a CPU, building the semantic
  index runs at a few passages per second (measured: about 5 per second in a Linux container,
  against about 120 with Apple silicon's GPU); a search query still takes tens of milliseconds.
- On Linux the runtime needs the OpenMP library (`libgomp1` on Debian and Ubuntu). A minimal install
  without it gets an error naming the package.
- Speed and quality depend on the computer: a 12B model needs about 10 GB of free memory.
- Smaller models follow long agent instructions and tool calls less reliably than hosted ones.

## Related guides

- [Connect model providers](providers.md)
- [Semantic search](semantic-search.md)
