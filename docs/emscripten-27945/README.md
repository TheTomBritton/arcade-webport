# emscripten #27945 — verification captures

Evidence for [emscripten-core/emscripten#27945](https://github.com/emscripten-core/emscripten/issues/27945)
(LEGACY_GL_EMULATION: planar client-side vertex arrays are not re-read on later
`glDrawArrays`).

All four captures are the same deterministic attract frame (660, the castle
flyover) of the Time Crisis web port, headless Chrome/SwiftShader, with the
app-side workaround (re-issuing the `gl*Pointer`s before every draw) disabled
via an env toggle so the emulation's own behaviour shows:

| file | emulation | result |
|---|---|---|
| `01-stock-bug.png` | stock | broken — one flush's stale geometry all frame |
| `02-earlyout-removed-only.png` | `modifiedClientAttributes` early-out removed (the diff proposed in the issue) | still broken — the restride pass has overwritten each `attr.pointer` into its staging buffer, so the re-run copy re-reads its own interleaved output with the planar strides |
| `03-full-fix.png` | early-out removed **+** `attr.pointer` left pointing at the client array | correct |
| `00-reference-workaround-on.png` | stock, app workaround on | correct (reference) |

`f660-headless.js` is the capture harness (puppeteer-core; expects the game
page served locally).
