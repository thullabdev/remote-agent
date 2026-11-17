/**
 * The composition root for the web UI's extensions: the one place the host loads an extension's frontend entry.
 * Everything else reaches an extension only through the slots in `extension-slots.ts` and the panel registry.
 * Add an extension here, one import line each.
 */
import '../../extensions/terminal/frontend/index.tsx'
import '../../extensions/git/frontend/index.tsx'
