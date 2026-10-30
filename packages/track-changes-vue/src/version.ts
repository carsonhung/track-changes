// `__TC_VERSION__` is replaced at build time by tsup (see tsup.config.ts),
// sourced from this package's package.json so the runtime value can never
// drift from the published version.
declare const __TC_VERSION__: string;

/**
 * Semver of `@carsonhung/track-changes-vue`, injected at build time.
 * Reads `0.0.0-dev` when imported from source rather than the built bundle.
 */
export const VERSION: string =
  typeof __TC_VERSION__ !== 'undefined' ? __TC_VERSION__ : '0.0.0-dev';
