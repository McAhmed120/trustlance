/**
 * Jest in ESM mode.
 *
 * The source is native ESM with explicit `.js` import specifiers (required by
 * NodeNext resolution), which Jest's resolver does not understand — hence the
 * moduleNameMapper that strips the extension back off. Running requires
 * `node --experimental-vm-modules`; see the `test` script in package.json.
 */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleNameMapper: {
    // './foo.js' -> './foo' so Jest can resolve the TypeScript source.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Test against the workspace package's source, not its built dist, so a
    // stale build can never make a red test look green.
    '^@trustlance/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  globalSetup: '<rootDir>/src/__tests__/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  // Tests share one Postgres database; parallel workers would truncate each
  // other's rows mid-test. --runInBand in the npm script enforces this too.
  maxWorkers: 1,
  // A failed-to-link suite skips afterAll, leaving redis/prisma handles open
  // and jest hanging forever. Force the exit once tests are done.
  forceExit: true,
  testTimeout: 20_000,
};
