# Audio IPC streaming channels (item 0015)

The typed IPC bridge established in item 0002 uses `ipcRenderer.invoke` / `ipcMain.handle` for request-response calls. Audio streaming introduces two channels that cannot fit that pattern:

- **`audio:frame`** (renderer → main, fire-and-forget): the renderer sends up to ~16 PCM frames per second. An invoke would create an IPC round-trip per frame and a queue of pending promises — measurable overhead and a pointless back-pressure mechanism for audio. Solution: `ipcRenderer.send` + `ipcMain.on`. No response, no promise.
- **`transcript:span`** (main → renderer, pushed event): the main process cannot invoke the renderer (invoke only goes renderer → main). Spans arrive asynchronously from the ASR provider's iterator. Solution: `webContents.send('transcript:span', span)` on the main side; `ipcRenderer.on('transcript:span', listener)` in the preload, exposed as `window.api.onTranscriptSpan(cb)` returning an unsubscribe function.

## Trade-offs accepted

**`ipcRenderer.send` is untyped at the Electron API level.** We compensate by keeping the channel name and payload type documented in `IpcOnewayChannel` in `src/shared/ipc.ts`, and by Zod-validating incoming spans on the renderer side before they touch the store.

**ScriptProcessorNode over AudioWorklet.** AudioWorklet is the modern replacement but requires serving a dedicated worklet script from a URL. In an Electron/Vite setup that means a build step that emits the worklet as a separate chunk and loads it via `audioContext.audioWorklet.addModule()`. The gain (off-main-thread audio processing) is marginal for this use case — we only need to resample and format PCM; the heavy lifting is done by the ASR provider in main. ScriptProcessorNode runs on the main renderer thread but the processing per frame is microseconds. This decision can be revisited in item 0016 if audio glitches appear.

## Consequences

The bridge pattern now has three IPC flavors:

1. `invoke` / `handle` — typed request-response (existing, unchanged)
2. `send` / `on` — one-way renderer → main (new: audio frames)
3. `webContents.send` / `ipcRenderer.on` — main → renderer push events (new: transcript spans)

Any future streaming channels (e.g. extraction progress, loopback audio) should follow the same pattern and be documented in `IpcOnewayChannel` / `RendererApi.onXxx`.
