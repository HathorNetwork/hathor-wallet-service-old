module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^@events/(.*)$': '<rootDir>/events/$1',
  },
  setupFiles: ['./tests/jestSetup.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/tests/utils.ts'],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 100,
      lines: 97,
      statements: 97,
    },
  },
};
