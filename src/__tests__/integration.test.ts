import { test, expect, describe } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lint } from '../linter.js'
import { applyFixes, isFixable } from '../fixer.js'
import { defaultConfig } from '../config/defaults.js'
import type { DepsLintConfig } from '../config/types.js'
import type { Diagnostic, DiagnosticType } from '../checks/types.js'

function createDir(...parts: string[]) {
	const dir = join(...parts)
	mkdirSync(dir, { recursive: true })
	return dir
}

function writeJson(filePath: string, data: unknown) {
	writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeTs(filePath: string, code: string) {
	writeFileSync(filePath, code.trim() + '\n')
}

function readJson(filePath: string) {
	return JSON.parse(readFileSync(filePath, 'utf-8'))
}

function createMonorepo() {
	const root = mkdtempSync(join(tmpdir(), 'deptective-e2e-'))

	// Root workspace config
	writeJson(join(root, 'package.json'), {
		name: 'monorepo',
		private: true,
		workspaces: ['packages/*'],
	})

	// --- packages/app ---
	const appSrc = createDir(root, 'packages', 'app', 'src')
	writeJson(join(root, 'packages', 'app', 'package.json'), {
		name: '@test/app',
		dependencies: {
			'@test/lib': 'workspace:*',
			'unused-dep': '^1.0.0',
		},
		devDependencies: {
			vitest: '^1.0.0',
		},
	})
	writeTs(join(appSrc, 'index.ts'), `
		import { hello } from '@test/lib'
		import { missing } from 'missing-pkg'
		export const greeting = hello()
	`)
	writeTs(join(appSrc, 'helpers.spec.ts'), `
		import { describe } from 'vitest'
		describe('helpers', () => {})
	`)
	writeJson(join(appSrc, 'tsconfig.json'), {
		references: [{ path: '../../lib/src' }],
	})

	// --- packages/lib ---
	const libSrc = createDir(root, 'packages', 'lib', 'src')
	writeJson(join(root, 'packages', 'lib', 'package.json'), {
		name: '@test/lib',
		dependencies: {},
	})
	writeTs(join(libSrc, 'index.ts'), `
		export function hello() { return 'hello' }
	`)
	writeJson(join(libSrc, 'tsconfig.json'), {})

	// --- packages/types ---
	const typesSrc = createDir(root, 'packages', 'types', 'src')
	writeJson(join(root, 'packages', 'types', 'package.json'), {
		name: '@test/types',
		dependencies: {
			'@test/lib': 'workspace:*',
		},
	})
	writeTs(join(typesSrc, 'index.ts'), `
		import type { hello } from '@test/lib'
		export type Hello = typeof hello
	`)
	writeJson(join(typesSrc, 'tsconfig.json'), {
		references: [{ path: '../../lib/src' }],
	})

	// --- packages/unused-ref ---
	const unusedRefSrc = createDir(root, 'packages', 'unused-ref', 'src')
	writeJson(join(root, 'packages', 'unused-ref', 'package.json'), {
		name: '@test/unused-ref',
		dependencies: {},
	})
	writeTs(join(unusedRefSrc, 'index.ts'), `
		export const x = 1
	`)
	writeJson(join(unusedRefSrc, 'tsconfig.json'), {
		references: [{ path: '../../lib/src' }],
	})

	return root
}

function diagsByType(diagnostics: Diagnostic[]) {
	const map = new Map<DiagnosticType, Diagnostic[]>()
	for (const d of diagnostics) {
		const list = map.get(d.type) ?? []
		list.push(d)
		map.set(d.type, list)
	}
	return map
}

// --- Full pipeline tests ---

describe('integration: monorepo lint', () => {
	test('detects missing dependency', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)
		const missing = result.diagnostics.filter(d => d.type === 'missing-dependency')
		expect(missing.some(d => d.module === 'missing-pkg' && d.packageName === '@test/app')).toBe(true)
	})

	test('detects unused dependency', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)
		const unused = result.diagnostics.filter(d => d.type === 'unused-dependency')
		expect(unused.some(d => d.module === 'unused-dep' && d.packageName === '@test/app')).toBe(true)
	})

	test('detects type-only dependency', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)
		const typeOnly = result.diagnostics.filter(d => d.type === 'type-only-dependency')
		expect(typeOnly.some(d => d.module === '@test/lib' && d.packageName === '@test/types')).toBe(true)
	})

	test('detects unused tsconfig reference', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)
		const unused = result.diagnostics.filter(d => d.type === 'unused-reference')
		expect(unused.some(d => d.packageName === '@test/unused-ref')).toBe(true)
	})

	test('does not flag devDependency in spec files', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)
		const devInSrc = result.diagnostics.filter(d => d.type === 'dev-dependency-in-source')
		expect(devInSrc.some(d => d.module === 'vitest')).toBe(false)
	})

	test('reports correct package count', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)
		expect(result.packageCount).toBe(4)
		expect(result.allPackages).toHaveLength(4)
	})

	test('filter limits lint to matching packages', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig, '@test/lib')
		expect(result.packageCount).toBe(1)
		// lib has no issues (no imports from external packages)
		expect(result.diagnostics).toHaveLength(0)
	})

	test('ignoredPackages skips specified packages', async () => {
		const root = createMonorepo()
		const config: DepsLintConfig = {
			...defaultConfig,
			ignoredPackages: ['@test/app'],
		}
		const result = await lint(root, config)
		expect(result.diagnostics.every(d => d.packageName !== '@test/app')).toBe(true)
	})
})

// --- Fix + re-lint cycle ---

describe('integration: fix workflow', () => {
	test('fix resolves unused dependency', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)

		const fixable = result.diagnostics.filter(d => isFixable(d.type))
		expect(fixable.length).toBeGreaterThan(0)

		applyFixes(fixable, { allPackages: result.allPackages, rootDir: root })

		// Re-lint
		const after = await lint(root, defaultConfig)
		const unusedAfter = after.diagnostics.filter(d => d.type === 'unused-dependency' && d.module === 'unused-dep')
		expect(unusedAfter).toHaveLength(0)
	})

	test('fix resolves type-only dependency by moving to devDependencies', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)

		const typeOnly = result.diagnostics.filter(d => d.type === 'type-only-dependency')
		expect(typeOnly.length).toBeGreaterThan(0)

		applyFixes(typeOnly, { allPackages: result.allPackages, rootDir: root })

		const typesPkg = readJson(join(root, 'packages', 'types', 'package.json'))
		expect(typesPkg.devDependencies?.['@test/lib']).toBe('workspace:*')
		expect(typesPkg.dependencies?.['@test/lib']).toBeUndefined()
	})

	test('fix resolves unused tsconfig reference', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)

		const unusedRef = result.diagnostics.filter(
			d => d.type === 'unused-reference' && d.packageName === '@test/unused-ref',
		)
		expect(unusedRef.length).toBeGreaterThan(0)

		applyFixes(unusedRef, { allPackages: result.allPackages, rootDir: root })

		const after = await lint(root, defaultConfig)
		expect(after.diagnostics.filter(d => d.type === 'unused-reference' && d.packageName === '@test/unused-ref')).toHaveLength(0)
	})

	test('dry-run does not modify files', async () => {
		const root = createMonorepo()
		const result = await lint(root, defaultConfig)
		const fixable = result.diagnostics.filter(d => isFixable(d.type))

		const pkgBefore = readFileSync(join(root, 'packages', 'app', 'package.json'), 'utf-8')

		applyFixes(fixable, { allPackages: result.allPackages, rootDir: root, dryRun: true })

		const pkgAfter = readFileSync(join(root, 'packages', 'app', 'package.json'), 'utf-8')
		expect(pkgAfter).toBe(pkgBefore)
	})
})

// --- Single package (non-workspace) ---

describe('integration: single package', () => {
	test('lints standalone package', async () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-single-'))
		const src = createDir(root, 'src')
		writeJson(join(root, 'package.json'), {
			name: 'standalone',
			dependencies: { unused: '^1.0.0' },
		})
		writeTs(join(src, 'index.ts'), `
			import { foo } from 'missing-dep'
			export { foo }
		`)

		const result = await lint(root, defaultConfig)
		expect(result.packageCount).toBe(1)

		const types = diagsByType(result.diagnostics)
		expect(types.get('missing-dependency')?.some(d => d.module === 'missing-dep')).toBe(true)
		expect(types.get('unused-dependency')?.some(d => d.module === 'unused')).toBe(true)
	})
})

// --- Config override ---

describe('integration: config', () => {
	test('globalModules suppresses missing-dependency', async () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-cfg-'))
		const src = createDir(root, 'src')
		writeJson(join(root, 'package.json'), { name: 'test-pkg' })
		writeTs(join(src, 'index.ts'), `
			import { x } from 'virtual:module'
		`)

		const config: DepsLintConfig = {
			...defaultConfig,
			globalModules: ['virtual:module'],
		}
		const result = await lint(root, config)
		expect(result.diagnostics.filter(d => d.type === 'missing-dependency')).toHaveLength(0)
	})

	test('bannedDependencies reports banned import', async () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-cfg-'))
		const src = createDir(root, 'src')
		writeJson(join(root, 'package.json'), {
			name: 'test-pkg',
			dependencies: { moment: '^2.0.0' },
		})
		writeTs(join(src, 'index.ts'), `
			import moment from 'moment'
			export default moment()
		`)

		const config: DepsLintConfig = {
			...defaultConfig,
			bannedDependencies: { moment: 'Use dayjs instead' },
		}
		const result = await lint(root, config)
		const banned = result.diagnostics.filter(d => d.type === 'banned-dependency')
		expect(banned).toHaveLength(1)
		expect(banned[0].message).toContain('Use dayjs instead')
	})

	test('packageOverrides apply per-package config', async () => {
		const root = createMonorepo()
		const config: DepsLintConfig = {
			...defaultConfig,
			packageOverrides: {
				'@test/app': {
					allowedUnusedDependencies: ['unused-dep'],
				},
			},
		}
		const result = await lint(root, config)
		const unused = result.diagnostics.filter(d => d.type === 'unused-dependency' && d.module === 'unused-dep')
		expect(unused).toHaveLength(0)
	})
})

// --- Workspace-level checks in full pipeline ---

describe('integration: workspace checks', () => {
	test('detects circular workspace dependency', async () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-circ-'))
		writeJson(join(root, 'package.json'), {
			name: 'monorepo',
			private: true,
			workspaces: ['packages/*'],
		})

		const aSrc = createDir(root, 'packages', 'a', 'src')
		writeJson(join(root, 'packages', 'a', 'package.json'), {
			name: '@test/a',
			dependencies: { '@test/b': 'workspace:*' },
		})
		writeTs(join(aSrc, 'index.ts'), `import { b } from '@test/b'`)

		const bSrc = createDir(root, 'packages', 'b', 'src')
		writeJson(join(root, 'packages', 'b', 'package.json'), {
			name: '@test/b',
			dependencies: { '@test/a': 'workspace:*' },
		})
		writeTs(join(bSrc, 'index.ts'), `import { a } from '@test/a'`)

		const result = await lint(root, defaultConfig)
		const circular = result.diagnostics.filter(d => d.type === 'circular-workspace-dependency')
		expect(circular).toHaveLength(1)
	})

	test('detects inconsistent versions across workspace', async () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-ver-'))
		writeJson(join(root, 'package.json'), {
			name: 'monorepo',
			private: true,
			workspaces: ['packages/*'],
		})

		const aSrc = createDir(root, 'packages', 'a', 'src')
		writeJson(join(root, 'packages', 'a', 'package.json'), {
			name: '@test/a',
			dependencies: { lodash: '^4.0.0' },
		})
		writeTs(join(aSrc, 'index.ts'), `import _ from 'lodash'`)

		const bSrc = createDir(root, 'packages', 'b', 'src')
		writeJson(join(root, 'packages', 'b', 'package.json'), {
			name: '@test/b',
			dependencies: { lodash: '^3.0.0' },
		})
		writeTs(join(bSrc, 'index.ts'), `import _ from 'lodash'`)

		const result = await lint(root, defaultConfig)
		const inconsistent = result.diagnostics.filter(d => d.type === 'inconsistent-version')
		expect(inconsistent).toHaveLength(1)
		expect(inconsistent[0].module).toBe('lodash')
	})
})

// --- Cross-tsconfig reference detection ---

describe('integration: cross-tsconfig references', () => {
	test('detects missing reference for relative import crossing tsconfig boundary', async () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-xref-'))
		writeJson(join(root, 'package.json'), { name: 'test-pkg' })

		const src = createDir(root, 'src')
		writeJson(join(src, 'tsconfig.json'), {})
		writeTs(join(src, 'index.ts'), `export const x = 1`)

		const test_ = createDir(root, 'test')
		writeJson(join(test_, 'tsconfig.json'), {
			compilerOptions: {},
			references: [], // missing reference to ../src!
		})
		writeTs(join(test_, 'index.test.ts'), `
			import { x } from '../src/index'
			console.log(x)
		`)

		const config: DepsLintConfig = {
			...defaultConfig,
			sourcePatterns: ['src/**/*.ts', 'test/**/*.ts'],
			tsconfigPath: 'test/tsconfig.json',
		}
		const result = await lint(root, config)
		const missing = result.diagnostics.filter(d => d.type === 'missing-reference')
		expect(missing).toHaveLength(1)
		expect(missing[0].message).toContain('../src')
	})

	test('does not report when reference exists for relative import', async () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-xref-'))
		writeJson(join(root, 'package.json'), { name: 'test-pkg' })

		const src = createDir(root, 'src')
		writeJson(join(src, 'tsconfig.json'), {})
		writeTs(join(src, 'index.ts'), `export const x = 1`)

		const test_ = createDir(root, 'test')
		writeJson(join(test_, 'tsconfig.json'), {
			compilerOptions: {},
			references: [{ path: '../src' }],
		})
		writeTs(join(test_, 'index.test.ts'), `
			import { x } from '../src/index'
			console.log(x)
		`)

		const config: DepsLintConfig = {
			...defaultConfig,
			sourcePatterns: ['src/**/*.ts', 'test/**/*.ts'],
			tsconfigPath: 'test/tsconfig.json',
		}
		const result = await lint(root, config)
		const missing = result.diagnostics.filter(d => d.type === 'missing-reference')
		expect(missing).toHaveLength(0)
	})
})
