# Dual-stream audio capture (microphone + system loopback)

To be useful for remote meetings (Teams/Zoom/Meet), the app captures two audio streams and mixes them into one source feeding the ASR Provider: the **microphone** (the local user) and **system audio loopback** (everyone else, who comes out of the speakers). On Windows this uses WASAPI loopback via Electron's `getDisplayMedia`. In-person mic-only is just the degenerate case with no loopback stream.

## Consequences

A microphone-only design would silently transcribe only the local user's half of any remote meeting, producing useless notes. That failure is invisible until someone tries it on a real call, so the dual-stream requirement is recorded here to stop a future "simplification" back to mic-only. Loopback capture carries a permissions and setup cost that mic-only would not.

---

## Platform caveat — item 0017 (2026-06-15)

### Windows / Electron: `getDisplayMedia` + `setDisplayMediaRequestHandler`

On Windows, `getDisplayMedia({ audio: true, video: false })` in an Electron
renderer does return WASAPI system-audio loopback — but **only when the main
process registers `session.setDisplayMediaRequestHandler`** (available since
Electron 17). Without this handler, Electron shows the native screen-picker
dialog, which is confusing for an audio-only loopback request and requires the
user to pick a source explicitly.

The handler in `src/main/index.ts` (`registerDisplayMediaHandler`) uses
`desktopCapturer.getSources({ types: ['screen'] })` to find the first screen
source, then calls `callback({ video: source, audio: 'loopback' })`. Passing
`audio: 'loopback'` is the key: it tells Electron/Chromium to return the WASAPI
loopback device for that screen, not the screen's video. The renderer's
`getDisplayMedia` call uses `video: false`, so no video frames are ever
captured or transmitted.

**Security posture**: the handler grants only audio loopback. It runs in the
main process. The renderer cannot escalate beyond what the handler explicitly
allows. `useSystemPicker: false` is set to suppress the native dialog.

### Graceful fallback on picker deny / platform mismatch

`AudioCaptureService._acquireLoopback()` wraps `getDisplayMedia` in a
try/catch and returns `null` on any error (including `NotAllowedError` from user
cancellation and `NotSupportedError` on platforms where loopback is unavailable).
The caller (`start()`) sets `loopbackState = 'denied'` and continues in mic-only
mode. No crash, no thrown error visible to the user beyond a status message.

### macOS / Linux

`getDisplayMedia` loopback is **not reliably available** on macOS or Linux without
additional virtual audio routing (e.g. BlackHole on macOS, PulseAudio loopback
module on Linux). The handler will find a screen source but `audio: 'loopback'`
may return no audio tracks. `AudioCaptureService` detects this
(`stream.getAudioTracks().length === 0`) and falls back to mic-only. This app
targets Windows exclusively for V1; the macOS/Linux path is an automatic graceful
degradation, not a supported configuration.

### Mixing architecture

Mixing runs in the renderer via the pure `mixPcm()` function
(`src/shared/audio/pcmMixer.ts`). Two `ScriptProcessorNode` instances tap the
mic and loopback `MediaStream`s separately; the loopback samples are stored in
`_latestLoopbackBuffer` and consumed by the primary (mic) processor on the next
audio callback. The combined Float32 buffer then passes through `PcmFramer`
(resampling + Int16 encoding) before being sent over IPC to the ASR provider.
This matches the existing IPC streaming pattern from ADR 0013.
