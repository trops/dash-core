module.exports = {
  testEnvironment: "jsdom",
  // The /scripts/ tree uses `node:test`, not jest — exclude so jest
  // doesn't try to load `require("node:test")` files and choke.
  testPathIgnorePatterns: ["/node_modules/", "/electron/", "/scripts/"],
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/"],
  moduleNameMapper: {
    "\\.(css|less|scss)$": "<rootDir>/src/__mocks__/styleMock.js",
    "^@trops/dash-react$": "<rootDir>/src/__mocks__/dash-react.js",
    // tailwindcss is a peer dep of consumers (dash-electron); not
    // installed in dash-core's own node_modules. Mock to an empty
    // object — only ColorModel imports it for color seed values
    // and tests that touch ColorModel don't need the real palette.
    "^tailwindcss/colors$": "<rootDir>/src/__mocks__/tailwindcssColorsMock.js",
  },
};
