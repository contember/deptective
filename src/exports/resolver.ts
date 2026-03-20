import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Check if a subpath import is valid according to the target package's `exports` field.
 * Returns:
 * - true: subpath is explicitly exported
 * - false: package has exports but this subpath is not exported
 * - null: package has no exports field (can't validate)
 */
export function isSubpathExported(
	packageName: string,
	subpath: string,
	rootDir: string,
): boolean | null {
	const exports = readPackageExports(packageName, rootDir)
	if (exports === null) return null

	const importPath = '.' + subpath // subpath is like "/client", we need "./client"
	return matchExports(exports, importPath)
}

type ExportsField = string | string[] | { [key: string]: ExportsField } | null

function readPackageExports(packageName: string, rootDir: string): ExportsField | null {
	// Try to find the package's package.json
	const candidates = [
		path.join(rootDir, 'node_modules', packageName, 'package.json'),
		// For scoped packages in hoisted layouts
		path.join(rootDir, 'node_modules', ...packageName.split('/'), 'package.json'),
	]

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'))
				return pkg.exports ?? null
			} catch {
				return null
			}
		}
	}
	return null
}

function matchExports(exports: ExportsField, subpath: string): boolean {
	if (exports === null) return false
	if (typeof exports === 'string') {
		// exports is a string — only the root "." is exported
		return subpath === '.'
	}
	if (Array.isArray(exports)) {
		return subpath === '.'
	}

	// exports is an object
	// Check if any key is a subpath pattern (starts with ".")
	const hasSubpathKeys = Object.keys(exports).some(k => k.startsWith('.'))
	if (!hasSubpathKeys) {
		// Conditional export for root only (e.g. { "import": "./index.mjs", "require": "./index.cjs" })
		return subpath === '.'
	}

	// Match against subpath patterns
	for (const pattern of Object.keys(exports)) {
		if (!pattern.startsWith('.')) continue
		if (matchSubpathPattern(pattern, subpath)) return true
	}

	return false
}

function matchSubpathPattern(pattern: string, subpath: string): boolean {
	if (pattern === subpath) return true

	const starIdx = pattern.indexOf('*')
	if (starIdx === -1) return false

	const prefix = pattern.substring(0, starIdx)
	const suffix = pattern.substring(starIdx + 1)

	return subpath.startsWith(prefix)
		&& subpath.endsWith(suffix)
		&& subpath.length >= prefix.length + suffix.length
}
