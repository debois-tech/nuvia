module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  testTimeout: 30000,
};
