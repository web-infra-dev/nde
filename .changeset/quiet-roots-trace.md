---
'ndepe': patch
---

Add a configurable, canonical dependency trace root and keep nft tracing and
path restoration aligned to the same boundary.
`traceOptions.base` can no longer override the ndepe-managed trace root.
