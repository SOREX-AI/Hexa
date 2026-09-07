#!/usr/bin/env node

// Stable public entry point; the implementation lives beside it so package
// scripts and contributor tooling share one command router.
await import('./hexa-launcher.mjs');
