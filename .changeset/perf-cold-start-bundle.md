---
default: patch
---

Speed up cold start by keeping the PDF viewer out of the initial bundle (it now loads on demand), cutting the amount of JavaScript fetched and parsed on launch. The desktop and mobile windows also paint the app's background color immediately, so startup no longer flashes a blank black screen before the first frame.
