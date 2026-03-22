import { test, expect, describe } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Diagnostic } from '../checks/types.js'
import type { FixContext } from '../checks/rule.js'
import type { WorkspacePackage } from '../workspace/types.js'
import { missingDependencyRule } from '../checks/rules/missing-dependency.js'
import { unusedDependencyRule } from '../checks/rules/unused-dependency.js'
import { typeOnlyDependencyRule } from '../checks/rules/type-only-dependency.js'
import { missingReferenceRule } from '../checks/rules/missing-reference.js'
import { unusedReferenceRule } from '../checks/rules/unused-reference.js'
import { extraneousTypesPackageRule } from '../checks/rules/extraneous-types-package.js'
import { isFixable, applyFixes } from '../fixer.js'

function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), 'deptective-fix-'))
}

function writePkgJson(dir: string, content: Record<string, unknown>) {
	writeFileSync(join(dir, 'package.json'), JSON.stringify(content, null, 2) + '\n')
}

function readPkgJson(dir: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
}

function createFixContext(overrides: Partial<FixContext> = {}): FixContext {
	return {
		packageIndex: new Map(),
		rootDir: '/tmp',
		dryRun: false,
		...overrides,
	}
}

function diag(type: Diagnostic['type'], packageDir: string, module: string): Diagnostic {
	return {
		type,
		packageName: 'test-pkg',
		packageDir,
		message: `test diagnostic for ${module}`,
		module,
	}
}

// --- isFixable ---

describe('isFixable', () => {
	test('returns true for fixable types', () => {
		expect(isFixable('missing-dependency')).toBe(true)
		expect(isFixable('unused-dependency')).toBe(true)
		expect(isFixable('missing-reference')).toBe(true)
		expect(isFixable('unused-reference')).toBe(true)
		expect(isFixable('type-only-dependency')).toBe(true)
		expect(isFixable('extraneous-types-package')).toBe(true)
	})

	test('returns false for non-fixable types', () => {
		expect(isFixable('self-import')).toBe(false)
		expect(isFixable('banned-dependency')).toBe(false)
		expect(isFixable('circular-workspace-dependency')).toBe(false)
	})
})

// --- missing-dependency fix ---

describe('missing-dependency fix', () => {
	test('adds workspace dependency', () => {
		const dir = createTempDir()
		writePkgJson(dir, { name: 'test-pkg' })

		const fooPkg: WorkspacePackage = { name: 'foo', dir: '/tmp/foo', packageJson: { name: 'foo' } }

		const result = missingDependencyRule.fix!(
			[diag('missing-dependency', dir, 'foo')],
			createFixContext({ packageIndex: new Map([['foo', fooPkg]]) }),
		)

		expect(result.fixed).toBe(1)
		expect(result.actions).toHaveLength(1)
		expect(result.actions[0].description).toContain('workspace:*')

		const pkg = readPkgJson(dir)
		expect((pkg.dependencies as any).foo).toBe('workspace:*')
	})

	test('resolves version from other workspace packages', () => {
		const dir = createTempDir()
		writePkgJson(dir, { name: 'test-pkg' })

		const otherPkg: WorkspacePackage = {
			name: 'other',
			dir: '/tmp/other',
			packageJson: { name: 'other', dependencies: { lodash: '^4.17.21' } },
		}

		const result = missingDependencyRule.fix!(
			[diag('missing-dependency', dir, 'lodash')],
			createFixContext({ packageIndex: new Map([['other', otherPkg]]) }),
		)

		expect(result.fixed).toBe(1)
		const pkg = readPkgJson(dir)
		expect((pkg.dependencies as any).lodash).toBe('^4.17.21')
	})

	test('dry run does not modify file', () => {
		const dir = createTempDir()
		writePkgJson(dir, { name: 'test-pkg' })
		const fooPkg: WorkspacePackage = { name: 'foo', dir: '/tmp/foo', packageJson: { name: 'foo' } }

		const result = missingDependencyRule.fix!(
			[diag('missing-dependency', dir, 'foo')],
			createFixContext({ packageIndex: new Map([['foo', fooPkg]]), dryRun: true }),
		)

		expect(result.fixed).toBe(1)
		expect(result.actions).toHaveLength(1)

		const pkg = readPkgJson(dir)
		expect(pkg.dependencies).toBeUndefined()
	})
})

// --- unused-dependency fix ---

describe('unused-dependency fix', () => {
	test('removes unused dependency', () => {
		const dir = createTempDir()
		writePkgJson(dir, { name: 'test-pkg', dependencies: { foo: '^1.0.0', bar: '^2.0.0' } })

		const result = unusedDependencyRule.fix!(
			[diag('unused-dependency', dir, 'foo')],
			createFixContext(),
		)

		expect(result.fixed).toBe(1)
		const pkg = readPkgJson(dir)
		expect((pkg.dependencies as any).foo).toBeUndefined()
		expect((pkg.dependencies as any).bar).toBe('^2.0.0')
	})

	test('removes dependencies field when last dep is removed', () => {
		const dir = createTempDir()
		writePkgJson(dir, { name: 'test-pkg', dependencies: { foo: '^1.0.0' } })

		unusedDependencyRule.fix!(
			[diag('unused-dependency', dir, 'foo')],
			createFixContext(),
		)

		const pkg = readPkgJson(dir)
		expect(pkg.dependencies).toBeUndefined()
	})
})

// --- type-only-dependency fix ---

describe('type-only-dependency fix', () => {
	test('moves dependency to devDependencies', () => {
		const dir = createTempDir()
		writePkgJson(dir, { name: 'test-pkg', dependencies: { '@types/node': '^20.0.0' } })

		const result = typeOnlyDependencyRule.fix!(
			[diag('type-only-dependency', dir, '@types/node')],
			createFixContext(),
		)

		expect(result.fixed).toBe(1)
		const pkg = readPkgJson(dir)
		expect((pkg.dependencies as any)?.['@types/node']).toBeUndefined()
		expect((pkg.devDependencies as any)['@types/node']).toBe('^20.0.0')
	})
})

// --- missing-reference fix ---

describe('missing-reference fix', () => {
	test('adds tsconfig reference by path', () => {
		const dir = createTempDir()
		writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
			references: [],
		}, null, '\t'))

		const result = missingReferenceRule.fix!(
			[diag('missing-reference', dir, './packages/lib')],
			createFixContext(),
		)

		expect(result.fixed).toBe(1)
		const content = readFileSync(join(dir, 'tsconfig.json'), 'utf-8')
		expect(content).toContain('packages/lib')
	})

	test('adds non-package reference (e.g. ../src)', () => {
		const dir = createTempDir()
		writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
			references: [],
		}, null, '\t'))

		const result = missingReferenceRule.fix!(
			[diag('missing-reference', dir, '../src')],
			createFixContext(),
		)

		expect(result.fixed).toBe(1)
		const content = readFileSync(join(dir, 'tsconfig.json'), 'utf-8')
		expect(content).toContain('../src')
	})
})

// --- unused-reference fix ---

describe('unused-reference fix', () => {
	test('removes tsconfig reference by path', () => {
		const dir = createTempDir()
		writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
			references: [
				{ path: './packages/lib' },
			],
		}, null, '\t') + '\n')

		const result = unusedReferenceRule.fix!(
			[diag('unused-reference', dir, './packages/lib')],
			createFixContext(),
		)

		expect(result.fixed).toBe(1)
		const content = readFileSync(join(dir, 'tsconfig.json'), 'utf-8')
		expect(content).not.toContain('packages/lib')
	})

	test('removes non-package reference', () => {
		const dir = createTempDir()
		writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
			references: [
				{ path: '../src' },
				{ path: '../shared' },
			],
		}, null, '\t') + '\n')

		const result = unusedReferenceRule.fix!(
			[diag('unused-reference', dir, '../src')],
			createFixContext(),
		)

		expect(result.fixed).toBe(1)
		const content = readFileSync(join(dir, 'tsconfig.json'), 'utf-8')
		expect(content).not.toContain('../src')
		expect(content).toContain('../shared')
	})
})

// --- extraneous-types-package fix ---

describe('extraneous-types-package fix', () => {
	test('removes @types package from devDependencies', () => {
		const dir = createTempDir()
		writePkgJson(dir, {
			name: 'test-pkg',
			devDependencies: { '@types/react': '^18.0.0', 'vitest': '^1.0.0' },
		})

		const result = extraneousTypesPackageRule.fix!(
			[diag('extraneous-types-package', dir, '@types/react')],
			createFixContext(),
		)

		expect(result.fixed).toBe(1)
		const pkg = readPkgJson(dir)
		expect((pkg.devDependencies as any)['@types/react']).toBeUndefined()
		expect((pkg.devDependencies as any).vitest).toBe('^1.0.0')
	})

	test('removes @types package from dependencies', () => {
		const dir = createTempDir()
		writePkgJson(dir, {
			name: 'test-pkg',
			dependencies: { '@types/node': '^20.0.0' },
		})

		const result = extraneousTypesPackageRule.fix!(
			[diag('extraneous-types-package', dir, '@types/node')],
			createFixContext(),
		)

		expect(result.fixed).toBe(1)
		const pkg = readPkgJson(dir)
		expect(pkg.dependencies).toBeUndefined()
	})
})

// --- applyFixes orchestrator ---

describe('applyFixes', () => {
	test('applies fixes for multiple diagnostic types', () => {
		const dir = createTempDir()
		writePkgJson(dir, { name: 'test-pkg', dependencies: { unused: '^1.0.0' } })

		const fooPkg: WorkspacePackage = { name: 'foo', dir: '/tmp/foo', packageJson: { name: 'foo' } }

		const diagnostics: Diagnostic[] = [
			diag('missing-dependency', dir, 'foo'),
			diag('unused-dependency', dir, 'unused'),
		]

		const result = applyFixes(diagnostics, {
			allPackages: [fooPkg],
			rootDir: '/tmp',
		})

		expect(result.fixed).toBe(2)
		const pkg = readPkgJson(dir)
		expect((pkg.dependencies as any).foo).toBe('workspace:*')
		expect((pkg.dependencies as any).unused).toBeUndefined()
	})

	test('skips non-fixable diagnostics', () => {
		const result = applyFixes(
			[diag('self-import', '/tmp', 'foo')],
			{ allPackages: [], rootDir: '/tmp' },
		)
		expect(result.fixed).toBe(0)
	})
})
