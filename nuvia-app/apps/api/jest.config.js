module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: { '^@nuvia/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/global-setup.ts',
};
