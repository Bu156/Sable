---
default: minor
---

Cache media responses and stream video/audio by byte range under Tauri for faster playback and lower bandwidth. Files larger than the cache budget are served without being persisted, so they no longer evict the whole cache on write.
