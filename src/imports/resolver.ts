import type { ImportRecord } from './collector.js'

const MODULE_RE = /^((?:@[\w_.-]+\/)?[\w_.-]+)(\/.*)?$/

export interface ResolvedImport {
	packageName: string
	hasSubpath: boolean
	subpath: string | null
	fullSpecifier: string
	file: string
	isTypeOnly: boolean
	isImportTypeExpression: boolean
}

export function resolveImports(
	records: ImportRecord[],
	tsconfigPaths: Record<string, string[]>,
): { resolved: ResolvedImport[]; dotImports: ImportRecord[] } {
	const resolved: ResolvedImport[] = []
	const dotImports: ImportRecord[] = []
	const pathMatchers = buildPathMatchers(tsconfigPaths)

	for (const record of records) {
		const { specifier } = record

		// Skip node/bun builtins
		if (specifier.startsWith('node:') || specifier.startsWith('bun:') || specifier === 'bun') continue

		// Relative imports
		if (specifier.startsWith('.')) {
			if (specifier === '.' || specifier === '..') {
				dotImports.push(record)
			}
			continue
		}

		// Skip tsconfig path aliases (they resolve to local files)
		if (matchesPathAlias(specifier, pathMatchers)) continue

		const match = specifier.match(MODULE_RE)
		if (!match) continue

		resolved.push({
			packageName: match[1],
			hasSubpath: !!match[2],
			subpath: match[2] ?? null,
			fullSpecifier: specifier,
			file: record.file,
			isTypeOnly: record.isTypeOnly,
			isImportTypeExpression: record.isImportTypeExpression,
		})
	}

	return { resolved, dotImports }
}

interface PathMatcher {
	prefix: string
	suffix: string
}

/**
 * Build matchers from tsconfig paths patterns.
 * Patterns can be:
 * - Exact: "foo" -> ["./bar"]
 * - Wildcard: "foo/*" -> ["./bar/*"]  (at most one * in both key and value)
 */
function buildPathMatchers(paths: Record<string, string[]>): PathMatcher[] {
	const matchers: PathMatcher[] = []
	for (const pattern of Object.keys(paths)) {
		const starIdx = pattern.indexOf('*')
		if (starIdx === -1) {
			// Exact match
			matchers.push({ prefix: pattern, suffix: '' })
		} else {
			matchers.push({
				prefix: pattern.substring(0, starIdx),
				suffix: pattern.substring(starIdx + 1),
			})
		}
	}
	return matchers
}

function matchesPathAlias(specifier: string, matchers: PathMatcher[]): boolean {
	for (const { prefix, suffix } of matchers) {
		if (suffix === '') {
			// Exact match or prefix-only (from "foo/*" -> prefix="foo/", suffix="")
			if (specifier === prefix || (prefix.endsWith('/') && specifier.startsWith(prefix))) {
				return true
			}
		} else {
			if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
				// Check that the wildcard matched at least 0 chars
				if (specifier.length >= prefix.length + suffix.length) {
					return true
				}
			}
		}
	}
	return false
}
