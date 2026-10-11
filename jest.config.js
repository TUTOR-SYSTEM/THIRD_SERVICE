/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
            decorators: true,
          },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
          target: 'es2021',
        },
        module: {
          type: 'commonjs',
        },
      },
    ],
  },
  testPathIgnorePatterns: ['/node_modules/', '/src/packages/interfaces/', '/test/packages/interfaces/'],
  collectCoverageFrom: ['src/**/*.(t|j)s', '!src/**/interface.ts', '!src/packages/interfaces/**'],
  coverageDirectory: './coverage',
  coverageProvider: 'v8',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@packages/(.*)$': '<rootDir>/src/packages/$1',
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};
