/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          target: "es2021",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          types: ["jest", "node"],
        },
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.(js|ts|tsx)"],
};
