# Electron shell with local ASR via ONNX + DirectML (no Python)

The app is an installed Windows desktop app (Electron + TypeScript + React), not a browser-hosted web app. Local Parakeet V3 runs as an exported **ONNX** model via sherpa-onnx, accelerated through **DirectML**, with a CPU fallback. We explicitly reject bundling a Python/NeMo/PyTorch runtime.

## Considered Options

- **Python sidecar running NeMo (CUDA):** best model fidelity, but ships multiple GB and, critically, gives zero acceleration on the target hardware.
- **ONNX in-process via DirectML (chosen):** no Python, small payload, runs on the iGPU.

## Consequences

The primary dev/target machine is an AMD Ryzen AI MAX, so there is no CUDA and ROCm-on-Windows is not viable. ONNX + DirectML is effectively the only path to GPU-accelerated local Parakeet on this hardware, which makes this less a preference than a constraint. The cost is that streaming a transducer (TDT/RNNT) model through ONNX is fiddlier than through native NeMo; if it proves unworkable a Python sidecar remains the documented fallback.

## Update — local path deferred, cloud ASR is the v1 default

The ONNX/DirectML streaming spike is **deferred**, not abandoned. Because the ASR Provider is a swappable seam, V1 ships with a **cloud ASR provider as the dependable default**, and local Parakeet via ONNX/DirectML is brought up behind the same interface afterward. Local-first remains the intended end state (privacy, cost), but it is no longer a V1 gate: if DirectML streaming doesn't pan out, cloud ASR carries the product and the local path stays a best-effort upgrade. This keeps the single biggest technical risk off the critical path.
