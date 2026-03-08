module.exports = {
    testEnvironment: "jsdom",
    transform: {
        "^.+\\.[jt]sx?$": "babel-jest",
    },
    transformIgnorePatterns: ["/node_modules/"],
    moduleNameMapper: {
        "\\.(css|less|scss)$": "<rootDir>/src/__mocks__/styleMock.js",
        "^@trops/dash-react$": "<rootDir>/src/__mocks__/dash-react.js",
    },
};
