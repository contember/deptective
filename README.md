# Deptective

A dependency linter for TypeScript monorepos and packages. Detects missing, unused, and misconfigured dependencies in `package.json` and TypeScript project references.

## Installation

```bash
npm install -D deptective
# or
bun add -d deptective
```

## Usage

```bash
# Lint all packages in the workspace
npx deptective

# Lint a specific package
npx deptective --filter my-package

# Auto-fix fixable issues
npx deptective --fix

# Preview fixes without applying them
npx deptective --dry-run

# JSON output
npx deptective --format json

# Custom config path
npx deptective --config ./my-config.json
```

### CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--config <path>` | `-c` | Path to config file |
| `--filter <name>` | `-f` | Only lint specific package(s) |
| `--format <type>` | | Output format: `text` (default), `json` |
| `--fix` | | Auto-fix issues where possible |
| `--dry-run` | | Show what `--fix` would do without writing |
| `--cwd <dir>` | | Working directory (default: cwd) |
| `--help` | `-h` | Show help |

## Programmatic API

```typescript
import { lint, loadConfig, applyFixes, isFixable, formatText } from 'deptective'

const config = await loadConfig(process.cwd())
const result = await lint(process.cwd(), config)

console.log(formatText(result.diagnostics))

const fixable = result.diagnostics.filter(d => isFixable(d.type))
if (fixable.length > 0) {
  applyFixes(fixable, { allPackages: result.allPackages, rootDir: process.cwd() })
}
```

## Rules

### Package-level rules

| Rule | Fixable | Description |
|------|---------|-------------|
| `missing-dependency` | Yes | Module is imported but missing from `package.json` dependencies |
| `unused-dependency` | Yes | Module is in dependencies but never imported in source |
| `missing-reference` | Yes | Import requires a tsconfig project reference that is missing |
| `unused-reference` | Yes | Tsconfig project reference is not used by any import |
| `type-only-dependency` | Yes | Module is only used as `import type` — should be in `devDependencies` |
| `forbidden-directory-import` | No | Subpath import of a package that does not export it (e.g. `foo/internal`) |
| `forbidden-dot-import` | No | Relative import of `.` or `..` |
| `self-import` | No | Package imports itself |
| `dev-dependency-in-source` | No | `devDependency` is imported in production source (non-test, non-config file) |
| `duplicate-dependency` | No | Same module listed in multiple dependency fields |
| `missing-peer-dependency` | No | A dependency has required peer dependencies that are not installed |
| `banned-dependency` | No | Import of a banned dependency |
| `dynamic-type-import` | No | `import('Foo')` in type position — use `import type` instead |
| `enforce-catalog` | No | Dependency version must use `catalog:` or `workspace:` protocol |
| `extraneous-types-package` | Yes | `@types/x` package is unnecessary because `x` ships its own types |

### Workspace-level rules

| Rule | Description |
|------|-------------|
| `circular-workspace-dependency` | Circular dependency chain between workspace packages |
| `inconsistent-version` | Same external dependency has different versions across packages |

## Configuration

Deptective looks for configuration in this order:

1. `deptective.config.ts`
2. `deptective.config.js`
3. `deptective.config.json`
4. `"deptective"` field in `package.json`

### Config file

```typescript
// deptective.config.ts
import type { DepsLintConfig } from 'deptective'

export default {
  // Modules that don't need to be in package.json (e.g. virtual modules)
  globalModules: ['virtual:generated-routes'],

  // Dependencies that are allowed to be unused
  allowedUnusedDependencies: ['@types/node'],

  // Subpath imports that are allowed (exact match or glob, e.g. foo/client, foo/**)
  allowedDirectoryImports: ['@mui/material/Button', '@my-org/mockup/**'],

  // Glob patterns for source files to scan
  sourcePatterns: ['src/**/*.{ts,tsx}'],

  // Glob patterns to exclude from scanning
  excludePatterns: ['**/*.d.ts', '**/generated/**'],

  // Packages to skip entirely
  ignoredPackages: ['@my-org/legacy-pkg'],

  // Path to tsconfig (auto-detected by default)
  tsconfigPath: null,

  // Glob patterns matching test files (devDependency imports are allowed here)
  testPatterns: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test/**'],

  // Dependencies that should not be used
  bannedDependencies: {
    'moment': 'Use dayjs instead',
    'lodash': 'Use lodash-es for tree-shaking',
  },

  // Require catalog: or workspace: protocol in these fields
  enforceCatalog: ['dependencies', 'devDependencies'],

  // Per-package config overrides
  packageOverrides: {
    '@my-org/cli': {
      allowedUnusedDependencies: ['commander'],
      testPatterns: ['**/*.test.*', '**/fixtures/**'],
    },
  },
} satisfies Partial<DepsLintConfig>
```

### Options reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `globalModules` | `string[]` | `[]` | Modules that don't need to be in dependencies |
| `allowedUnusedDependencies` | `string[]` | `[]` | Dependencies allowed to be unused |
| `allowedDirectoryImports` | `string[]` | `[]` | Subpath imports that are allowed — exact strings or glob patterns (`*`, `**`, `?`) |
| `sourcePatterns` | `string[]` | `['src/**/*.{ts,tsx}']` | Source file glob patterns |
| `excludePatterns` | `string[]` | `['**/*.d.ts', '**/generated/**']` | Excluded file glob patterns |
| `ignoredPackages` | `string[]` | `[]` | Packages to skip |
| `tsconfigPath` | `string \| null` | `null` | Custom tsconfig path |
| `testPatterns` | `string[]` | `['**/*.test.*', ...]` | Test file patterns (devDeps allowed here) |
| `bannedDependencies` | `Record<string, string>` | `{}` | Banned deps with reason |
| `enforceCatalog` | `string[]` | `[]` | Dependency fields requiring catalog:/workspace: |
| `packageOverrides` | `Record<string, ...>` | `{}` | Per-package config overrides |

## License

MIT
