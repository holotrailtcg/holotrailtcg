const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

module.exports = {
  transform: {
    // Admin component specs (`*.component.spec.tsx`) are the only files
    // parsed with JSX enabled; every other file keeps the plain TypeScript
    // parser so generic arrow functions like `<T>() => {}` are never
    // misread as JSX.
    "^.+\\.tsx$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true, decorators: true },
          transform: { react: { runtime: "automatic" } },
        },
      },
    ],
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "tsx", "json"],
  moduleNameMapper: {
    "\\.css$": "<rootDir>/integration-tests/style-mock.js",
  },
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  setupFiles: ["./integration-tests/setup-text-encoding.js", "./integration-tests/setup.js"],
};

// Every one of these trading-card specs bootstraps a real `MedusaApp` for the
// same custom `TRADING_CARDS_MODULE` in their own `beforeAll`.
// `@medusajs/modules-sdk` keeps a process-wide loader registry for each named
// custom module, and that registry is not safely re-enterable for the same
// module name a second time in one process: two such bootstraps sharing a
// single Jest worker crash with `Method Map.prototype.set called on
// incompatible receiver #<Map>` (verified to reproduce regardless of file
// order, and regardless of clearing `MedusaModule`'s own instance registry
// between them — the corruption sits below that registry). A plain
// shared-fixture/`globalThis` cache cannot fix this either: Jest gives every
// spec *file* its own global object, so no in-memory state set by one file's
// `beforeAll` is ever visible to another file's `beforeAll` (confirmed
// directly against this repository's exact Jest config). The only reliable
// fix is to make sure no two of these files ever bootstrap
// `TRADING_CARDS_MODULE` inside the *same* OS process. See the
// `test:integration:modules` script in `package.json`, which runs this list
// in its own `jest` invocation with `--maxWorkers` set to exactly the number
// of files listed (no `--runInBand`), so Jest schedules one file per worker
// process with none reused/shared. If a file is added to or removed from
// this list, `--maxWorkers` in `package.json` must be updated to match, or a
// worker gets reused across two files and either the registry crash above or
// a concurrent-DDL deadlock (multiple `beforeAll`s re-applying the same
// migration at once) can result. Every other module spec (including the
// count-based Stage 4A.3 migration spec, which must not race against
// concurrent row inserts from a parallel worker) keeps running sequentially
// in one process exactly as before.
const TRADING_CARDS_MEDUSA_APP_SPEC_PATTERNS = [
  "src/modules/trading-cards/__tests__/trading-cards-module\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/tcgdex-enrichment-persistence\\.integration\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/trading-card-image-confirmation\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/trading-card-image-focal-point\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/trading-card-image-expiry-sweep\\.spec\\.ts$",
];

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
  if (process.env.MODULE_TESTS_EXCLUDE_MEDUSA_APP_PAIR === "true") {
    module.exports.testPathIgnorePatterns = ["/node_modules/", ...TRADING_CARDS_MEDUSA_APP_SPEC_PATTERNS];
  }
} else if (process.env.TEST_TYPE === "unit") {
  // Admin component specs opt into jsdom per-file via a `@jest-environment
  // jsdom` docblock (see review-actions and the review detail page specs);
  // every other unit spec keeps the default "node" environment above.
  module.exports.testMatch = [
    "**/src/**/__tests__/**/*.unit.spec.[jt]s",
    "**/src/admin/**/__tests__/**/*.component.spec.tsx",
  ];
}
