export default {
    verbose: true,
    transform: {
        '^.+\\.ts?$': '<rootDir>/jest-transform.cjs',
    },
    testEnvironment: 'jsdom',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};
