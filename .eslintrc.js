module.exports = {
  root: true,
  extends: ["preact"],
  settings: {
    react: {
      pragma: "h",
    },
  },
  env: {
    browser: true,
    es2021: true,
    node: true,
    commonjs: true,
  },
  plugins: ["@typescript-eslint", "simple-import-sort", "unused-imports", "prettier"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:prettier/recommended"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    "@typescript-eslint/no-unused-vars": "off",
    "simple-import-sort/imports": [
      "error",
      {
        groups: [["^\\u0000"], ["^@?\\w"], ["^src(/.*|$)"]],
      },
    ],
    "simple-import-sort/exports": "error",
    "no-unused-vars": "off",
    "unused-imports/no-unused-imports": "error",
    "unused-imports/no-unused-vars": [
      "error",
      {
        vars: "all",
        varsIgnorePattern: "^_",
        args: "after-used",
        argsIgnorePattern: "^_",
      },
    ],
    "no-console": [
      "error",
      {
        allow: ["warn", "error", "info"],
      },
    ],
    "prettier/prettier": [
      "error",
      {
        arrowParens: "always",
        bracketSpacing: true,
        endOfLine: "lf",
        htmlWhitespaceSensitivity: "css",
        printWidth: 100,
        quoteProps: "as-needed",
        semi: true,
        singleQuote: true,
        tabWidth: 2,
        trailingComma: "es5",
        useTabs: false,
      },
    ],
    // TODO: change this back to error
    "@typescript-eslint/no-explicit-any": "warn",
  },
  overrides: [
    {
      files: ["**/*.test.*"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
    {
      // @dimo-network/transactions/accounts/core must load no signer or chain code
      // (scripts/check-dist.mjs checks the built output too).
      files: ["src/accounts/core/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@turnkey/*", "viem", "viem/*", "@zerodev/*"],
                message: "src/accounts/core must stay free of signer/chain dependencies.",
              },
            ],
            paths: [{ name: "fetch", message: "src/accounts/core must not use fetch." }],
          },
        ],
        "no-restricted-globals": ["error", { name: "fetch", message: "src/accounts/core must not use fetch." }],
      },
    },
    {
      // @dimo-network/transactions/accounts/auth and /accounts/directory must load no
      // smart-account, passkey or Turnkey code (scripts/check-dist.mjs and
      // test/accounts/entries.test.ts check the module graph too).
      files: ["src/accounts/auth/**/*.ts", "src/accounts/directory/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@turnkey/*", "viem", "viem/*", "@zerodev/*", "../account/*", "../signers/turnkey*"],
                message:
                  "src/accounts/auth and src/accounts/directory must stay free of smart-account, passkey and Turnkey code.",
              },
            ],
          },
        ],
      },
    },
  ],
};
