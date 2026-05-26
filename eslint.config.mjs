import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}, {
    files: ["src/test/**/*.ts"],
    languageOptions: {
        globals: {
            suite: "readonly",
            test: "readonly",
            suiteSetup: "readonly",
            suiteTeardown: "readonly",
            setup: "readonly",
            teardown: "readonly",
            describe: "readonly",
            it: "readonly",
            before: "readonly",
            after: "readonly",
            beforeEach: "readonly",
            afterEach: "readonly",
        },
    },
}];