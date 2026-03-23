# Deptective

Dependency linter for TypeScript monorepos and packages.

## Commands

- `bun test` — run tests
- `bun run typecheck` — type check (`tsc --noEmit`)
- `bun run build` — build (`tsc`)
- `bun src/cli.ts` — run the linter on the current project

## Releasing

Release is triggered by pushing a `v*` tag. The `release.yml` workflow:
1. Parses version from the tag (e.g. `v0.2.0` → `0.2.0`)
2. Sets the version in `package.json` automatically (no need to bump manually)
3. Runs typecheck, tests, build
4. Publishes to npm with `--provenance`

To release: `git tag v<version> && git push origin v<version>`

The `version` field in `package.json` is not kept in sync — the CI overrides it from the tag.
