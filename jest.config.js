module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '.',
    testRegex: '.*\\.spec\\.ts$',
    transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
    },
    collectCoverageFrom: ['**/*.(t|j)s'],
    coverageDirectory: './coverage',
    testEnvironment: 'node',
    roots: ['<rootDir>/apps/', '<rootDir>/libs/'],
    moduleNameMapper: {
        '^@examio/database(.*)$': '<rootDir>/libs/database/src/$1',
        '^@examio/common(.*)$': '<rootDir>/libs/common/src/$1',
        '^@examio/redis(.*)$': '<rootDir>/libs/redis/src/$1',
    },
    testTimeout: 30000,
};
