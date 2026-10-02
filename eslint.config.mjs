import globals from "globals";
import pluginJs from "@eslint/js";


/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ["node_modules/**", "coverage/**"] },
  pluginJs.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
];
