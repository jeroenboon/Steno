# Electron shell with local ASR via ONNX + DirectML (no Python)

The app is an installed Windows desktop app (Electron + TypeScript + React), not a browser-hosted web app. Local Parakeet V3 runs as an exported **ONNX** model via sherpa-onnx, accelerated through **DirectML**, with a CPU fallback. We explicitly reject bundling a Python/NeMo/PyTorch runtime.

## Considered Options

- **Python sidecar running NeMo (CUDA):** best model fidelity, but ships multiple GB and, critically, gives zero acceleration on the target hardware.
- **ONNX in-process via DirectML (chosen):** no Python, small payload, runs on the iGPU.

## Consequences

The primary dev/target machine is an AMD Ryzen AI MAX, so there is no CUDA and ROCm-on-Windows is not viable. ONNX + DirectML is effectively the only path to GPU-accelerated local Parakeet on this hardware, which makes this less a preference than a constraint. The cost is that streaming a transducer (TDT/RNNT) model through ONNX is fiddlier than through native NeMo; if it proves unworkable a Python sidecar remains the documented fallback.

## Update — local path deferred, cloud ASR is the v1 default

The ONNX/DirectML streaming spike is **deferred**, not abandoned. Because the ASR Provider is a swappable seam, V1 ships with a **cloud ASR provider as the dependable default**, and local Parakeet via ONNX/DirectML is brought up behind the same interface afterward. Local-first remains the intended end state (privacy, cost), but it is no longer a V1 gate: if DirectML streaming doesn't pan out, cloud ASR carries the product and the local path stays a best-effort upgrade. This keeps the single biggest technical risk off the critical path.

## Update — spike + implementatie (item 0024, stap 1)

Model: `onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4` (Cache-Aware
FastConformer-RNNT, MIT-licentie). Geen Python/NeMo-export nodig; model al als ONNX INT4
beschikbaar.

Runtime: `onnxruntime-genai`, DirectML EP met CPU-fallback. Werkt op AMD/Intel/NVIDIA
via DirectML zonder aparte GPU-builds.

Spike resultaten (in te vullen na test op doelhardware):

- RTF op DirectML (AMD Ryzen AI): [meetwaarde]
- RTF op CPU: [meetwaarde]
- Dutch WER (informele test, ~2 min vergadering): [meetwaarde]
- DirectML laadtijd: [meetwaarde]

Implementatie: `LocalAsrProvider` in `src/main/providers/LocalAsrProvider.ts`.
Chunk-formaat 560 ms, geen `isFinal`-veld (per ADR 0011: isFinal absent = treated as final).
ONNX session hidden achter `OnnxSessionFactory` interface (testbaar via `FakeOnnxSessionFactory`).
Model gedownload naar `userData/models/nemotron-3.5-asr-streaming-0.6b-int4/` bij eerste gebruik
vanuit Settings via `ModelDownloader` met SHA-256 verificatie.

Beslissing omtrent go/no-go: go-pad geïmplementeerd. Spike-metingen worden ingevuld bij
eerste run op AMD Ryzen AI hardware. Als WER > 15% blijft, is stap 2 (Dutch fine-tune via
`yuriyvnv/parakeet-tdt-0.6b-dutch`) het vervolgtraject.
