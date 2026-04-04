/**
 * Loader hook that makes `require` available in ESM context.
 * Needed because better-sqlite3 uses native bindings loaded via require().
 */
import { createRequire } from "node:module";

globalThis.require ??= createRequire(import.meta.url);
