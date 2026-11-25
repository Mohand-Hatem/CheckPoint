import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@nestjs/schedule$': '<rootDir>/../test/support/nestjs-schedule.mock.ts',
  },
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/main.ts', '!**/prisma/**'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
