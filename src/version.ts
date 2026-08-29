/**
 * One version literal for the whole server.
 *
 * package.json cannot be imported here: it sits outside `rootDir`, so tsc
 * refuses to emit for it. Instead the constant lives here and a test asserts
 * it still matches package.json, which turns a silent drift between the npm
 * version and the version advertised over MCP into a failing build.
 */
export const VERSION = "3.0.0";
