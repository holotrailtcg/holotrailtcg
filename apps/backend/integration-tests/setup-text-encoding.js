// jsdom (used only by Admin component specs, via a `@jest-environment jsdom`
// docblock) does not provide `TextEncoder`/`TextDecoder` as globals, but
// `integration-tests/setup.js` transitively requires `pg`, which needs them
// at module-load time regardless of test environment. This must run before
// that file, for every test environment; in the default "node" environment
// these globals already exist, so the assignment is a harmless no-op there.
if (typeof global.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("node:util")
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}
