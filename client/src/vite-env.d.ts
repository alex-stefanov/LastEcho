/// <reference types="vite/client" />

// vite.config.ts runs under Node; type just the bits we use without pulling in
// all of @types/node.
declare const process: { env: Record<string, string | undefined> };
