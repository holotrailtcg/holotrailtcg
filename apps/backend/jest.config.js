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
// directly against this repository's exact Jest config).
//
// A `--maxWorkers` scheme that gives each of these files its own worker
// process (one file per worker, as this used to run) fixes the loader-registry
// crash above, but every worker still connects to the *same* physical
// PostgreSQL test database — matching the file count to `--maxWorkers` is
// process isolation, not database isolation. Several of these `beforeAll`s
// independently re-apply the same trading-card migrations to widen audit
// checks; run concurrently from separate worker processes, those concurrent
// DDL statements can deadlock, race to create duplicate constraints, or leave
// an incompatible audit check behind for whichever spec runs its assertions
// next. The only reliable fix is to make sure no two of these files ever run
// at the same time, in any process, against this database. See the
// `test:integration:modules` script in `package.json`, which chains one
// `jest --runTestsByPath <file> --runInBand` invocation per file with `&&`,
// each a fresh OS process running exactly one spec to completion before the
// next one starts. If a file is added to or removed from this list, the
// chained invocations in `package.json` must be updated to match — an
// omitted file silently stops running, and a file added to the broad phase
// without being added here reintroduces the concurrent-bootstrap crash.
// Every other module spec (including the count-based Stage 4A.3 migration
// spec, which must not race against concurrent row inserts from a parallel
// worker) keeps running sequentially in the first, broad `--runInBand`
// invocation exactly as before.
const TRADING_CARDS_MEDUSA_APP_SPEC_PATTERNS = [
  "src/modules/trading-cards/__tests__/trading-cards-module\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/tcgdex-enrichment-persistence\\.integration\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/trading-card-image-confirmation\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/trading-card-image-focal-point\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/trading-card-image-expiry-sweep\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/trading-card-image-orphan-reconciliation\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/trading-card-product-media-reconcile\\.integration\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/retry-tcgdex-lookup-candidate\\.integration\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/resolve-ambiguous-tcgdex-lookup-candidate\\.integration\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/update-trading-card-illustrator\\.integration\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/ensure-product-taxonomy\\.integration\\.spec\\.ts$",
];

// Stage 5B.1 Slice 2: the same `MedusaApp`-loader-registry conflict
// documented above for `TRADING_CARDS_MODULE` now also applies to
// `TRADING_CARD_INVENTORY_MODULE`, once more than one spec file boots it in
// its own `beforeAll`. `trading-card-inventory-module.spec.ts` was safe
// alone; adding the two new Pulse-import specs (one of which also boots
// `TRADING_CARDS_MODULE` in the same call) reintroduces the exact crash, so
// all three must be isolated from the broad pass and from each other the
// same way — see the `test:integration:modules` script in `package.json`.
const TRADING_CARD_INVENTORY_MEDUSA_APP_SPEC_PATTERNS = [
  "src/modules/trading-card-inventory/__tests__/trading-card-inventory-module\\.spec\\.ts$",
  "src/modules/trading-card-inventory/__tests__/pulse-import-service-methods\\.integration\\.spec\\.ts$",
  "src/modules/trading-card-inventory/__tests__/import-pulse-csv-snapshot\\.integration\\.spec\\.ts$",
  "src/modules/trading-card-inventory/__tests__/medusa-inventory-sync\\.integration\\.spec\\.ts$",
  "src/modules/trading-cards/__tests__/create-card-from-inventory-row\\.integration\\.spec\\.ts$",
  "src/modules/trading-card-inventory/__tests__/select-alternative-tcgdex-match\\.integration\\.spec\\.ts$",
  "src/modules/trading-card-inventory/__tests__/set-requires-separate-listing-override\\.integration\\.spec\\.ts$",
  "src/modules/trading-card-inventory/__tests__/split-inventory-proposal\\.integration\\.spec\\.ts$",
  "src/modules/trading-card-inventory/__tests__/category-assignment-apply-gate\\.integration\\.spec\\.ts$",
  "src/modules/trading-card-inventory/__tests__/medusa-inventory-sync-category-assignment\\.integration\\.spec\\.ts$",
];

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
  if (process.env.MODULE_TESTS_EXCLUDE_MEDUSA_APP_PAIR === "true") {
    module.exports.testPathIgnorePatterns = [
      "/node_modules/", ...TRADING_CARDS_MEDUSA_APP_SPEC_PATTERNS, ...TRADING_CARD_INVENTORY_MEDUSA_APP_SPEC_PATTERNS,
    ];
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
