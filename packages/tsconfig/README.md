# `@katha/tsconfig`

Shared TypeScript 7 compiler configuration presets for the Katha monorepo.

## Exports

- `@katha/tsconfig/base.json` — Strict TypeScript 7 baseline (`erasableSyntaxOnly`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `declarationMap`)
- `@katha/tsconfig/node.json` — Node.js 26 ESM services and compiled packages (`NodeNext`)
- `@katha/tsconfig/react.json` — Vite / TanStack Start React applications (`Bundler`)

## Usage

```json
{
  "extends": "@katha/tsconfig/node.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
```
