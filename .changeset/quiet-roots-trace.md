---
'ndepe': patch
---

Add a configurable dependency trace root and keep nft tracing and path
restoration aligned to the same boundary.
`traceOptions.base`, `traceOptions.processCwd`, and `traceOptions.cache` can no
longer override ndepe-managed values.
