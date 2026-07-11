/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'routes/**/*.js',
    'middleware/**/*.js',
    'utils.js',
    'db-helper.js',
    '!**/node_modules/**'
  ],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 45,
      lines: 55,
      statements: 50
    }
  },
  coverageReporters: ['text', 'lcov'],
  verbose: true,
  testTimeout: 10000,
  forceExit: true
};
