# Electron shell with local ASR via ONNX + DirectML (no Python)

The app is an installed Windows desktop app (Electron + TypeScript + React), not a browser-hosted web app. Local Parakeet V3 runs as an exported **ONNX** model via sherpa-onnx, accelerated through **DirectML**, with a CPU fallback. We explicitly reject bundling a Python/NeMo/PyTorch runtime.

## Considered Options

- **Python sidecar running NeMo (CUDA):** best model fidelity, but ships multiple GB and, critically, gives zero acceleration on the target hardware.
- **ONNX in-process via DirectML (chosen):** no Python, small payload, runs on the iGPU.

## Consequences

The primary dev/target machine is an AMD Ryzen AI MAX, so there is no CUDA and ROCm-on-Windows is not viable. ONNX + DirectML is effectively the only path to GPU-accelerated local Parakeet on this hardware, which makes this less a preference than a constraint. The cost is that streaming a transducer (TDT/RNNT) model through ONNX is fiddlier than through native NeMo; if it proves unworkable a Python sidecar remains the documented fallback.

## Update — local path deferred, cloud ASR is the v1 default

The ONNX/DirectML streaming spike is **deferred**, not abandoned. Because the ASR Provider is a swappable seam, V1 ships with a **cloud ASR provider as the dependable default**, and local Parakeet via ONNX/DirectML is brought up behind the same interface afterward. Local-first remains the intended end state (privacy, cost), but it is no longer a V1 gate: if DirectML streaming doesn't pan out, cloud ASR carries the product and the local path stays a best-effort upgrade. This keeps the single biggest technical risk off the critical path.

## Update — onnxruntime-genai: no-go (item 0024)

Geïmplementeerd met `onnxruntime-genai` als runtime en het
`onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4` model. Resultaat: **no-go.**

Root cause: `onnxruntime-genai` heeft geen Node.js npm-pakket. De ASR API bestaat alleen in
Python, C# en C++. De dynamische import faalt silent; de provider stopt onmiddellijk zonder
ooit een span te emitteren. De spike is niet uitgevoerd vóór de implementatie — de
placeholder `DefaultOnnxSessionFactory.transcribe()` bevestigt dit.

Tevens onderzocht: Transformers.js (WebGPU renderer-only, botst met ADR 0005) en Python
sidecar (te veel distributiehoofdpijn voor de geboden meerwaarde).

## Update — pivot naar sherpa-onnx + Whisper (item 0024, v2)

**Runtime:** `sherpa-onnx` (`npm install sherpa-onnx`), native addon, zelfde dual-ABI
patroon als `better-sqlite3`. Production-quality (~18k GitHub stars, v1.13.3, actief).

**Model:** Whisper large-v3 multilingual (pre-converted sherpa-onnx formaat, direct
downloadbaar). Dutch fine-tune als post-launch upgrade zodra conversie-kwaliteit gemeten is.

**Nemotron losgelaten:** het ONNX INT4 model is verpakt voor onnxruntime-genai en niet
compatibel met sherpa-onnx. Conversie vereist Python/NeMo — meer werk dan overstappen op
een Whisper model dat sherpa-onnx al ondersteunt.

**DirectML:** standaard `npm install sherpa-onnx` is CPU-only op Windows. DirectML vereist
een custom sherpa-onnx build (AMD productiegids beschikbaar, jan 2026). V1 draait op CPU;
DirectML is een post-launch stretch goal, niet een V1-gate.

**Streaming:** sherpa-onnx Whisper is batch-per-chunk (niet token-streaming). Elke chunk
levert één `TranscriptSpan` zonder `isFinal` veld — per ADR 0011 behandeld als final. Past
in het bestaande `ASRProvider` patroon.

Spike resultaten (in te vullen na de sherpa-onnx spike):

- RTF op CPU (AMD Ryzen AI MAX): [meetwaarde]
- Dutch WER (informele test, ~2 min vergadering): [meetwaarde]
- Model laadtijd eerste keer: [meetwaarde]

Zie `docs/handoff-sherpa-onnx-pivot.md` voor de volledige onderzoekscontext.

## Update: WASM-build kan large-v3 niet laden, voorlopig terug naar Whisper small

Bij het echt opstarten van de lokale provider bleek het `sherpa-onnx` npm-pakket de
**pure-WASM build** te zijn (`sherpa-onnx-wasm-nodejs.js`), niet een native addon. Dat is
32-bits emscripten: de heap kan geen ONNX-decodersessie van large-v3 opzetten (encoder
766 MB + decoder 1 GB). De recognizer faalt op
`offline-whisper-model.cc:InitDecoder:401` met `exit(-1)`. Geheugen, geen configfout.

Daarvóór zat een aparte bug: de tokens werden gedownload als `tokens.txt`, maar de HF-repo
publiceert ze als `large-v3-tokens.txt`. Die URL gaf 404 en `download()` controleerde geen
`response.ok`, dus de foutpagina ("Entry not found", 15 bytes) belandde als modelbestand op
schijf. Native `ReadTokens` brak daarop af. Gefixt: juiste bestandsnaam + ok-check in
`download()`.

**Beslissing:** voorlopig Whisper **small** multilingual (`sherpa-onnx-whisper-small`,
~357 MB int8: encoder 107 MB, decoder 250 MB, tokens 1 MB). Die laadt wél onder de
WASM-build; end-to-end transcriptie (model laden, `acceptWaveform`, `decode`, `getResult`)
is geverifieerd onder de Electron-runtime met een testfragment. Modelmap en `modelId`
heten nu `whisper-small-sherpa`.

Dit houdt lokale ASR nu werkend. De kwaliteitskeuze staat nog open: als small voor
Nederlands te zwak is, zijn de opties (a) een native sherpa-onnx build / `sherpa-onnx-node`
(64-bits ONNX Runtime, geen 2 GB-plafond, herintroduceert native ABI-zorgen) zodat large-v3
of een distil-variant past, of (b) een groter model dat nog binnen de WASM-heap valt. Die
afweging is bewust uitgesteld tot de Dutch WER van small gemeten is.
