---
default: patch
---

Stop leaking `wry`/`tauri-runtime-wry` into CEF builds via `tauri-plugin-notifications` and `tauri-plugin-devtools`. CEF builds (`--no-default-features --features cef`) no longer pull `wry` or `tauri-runtime-wry`; `webkit2gtk` still comes in via `tauri-runtime` (upstream). Also removes the broken `not(feature = "cef")` target-cfg gate that produced a cargo warning.
