// Keep values shared by Next config and application code in a dependency-free
// module. Importing next.config.ts into a page bundle pulls build-time plugins
// into Turbopack/Webpack and breaks the app before it can render.
export const TRAILING_SLASH = false;
