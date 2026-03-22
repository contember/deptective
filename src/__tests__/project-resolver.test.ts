import { test, expect, describe } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { TsConfigData } from '../tsconfig/reader.js'
import type { ImportRecord } from '../imports/collector.js'
import type { ResolvedImport } from '../imports/resolver.js'
import type { WorkspacePackage } from '../workspace/types.js'
import { resolveReferenceDirs, resolveImportTargetDirs, findOwningProjectDir } from '../tsconfig/project-resolver.js'

function createTempMonorepo() {
	const root = mkdtempSync(join(tmpdir(), 'deptective-pr-'))

	// packages/app/src/ with tsconfig
	mkdirSync(join(root, 'packages', 'app', 'src'), { recursive: true })
	writeFileSync(join(root, 'packages', 'app', 'src', 'tsconfig.json'), '{}')

	// packages/app/test/ with tsconfig
	mkdirSync(join(root, 'packages', 'app', 'test'), { recursive: true })
	writeFileSync(join(root, 'packages', 'app', 'test', 'tsconfig.json'), '{}')

	// packages/lib/src/ with tsconfig
	mkdirSync(join(root, 'packages', 'lib', 'src'), { recursive: true })
	writeFileSync(join(root, 'packages', 'lib', 'src', 'tsconfig.json'), '{}')

	// packages/utils/ with tsconfig at root (no src/)
	mkdirSync(join(root, 'packages', 'utils'), { recursive: true })
	writeFileSync(join(root, 'packages', 'utils', 'tsconfig.json'), '{}')

	// shared/ directory (not a package, no package.json)
	mkdirSync(join(root, 'shared'), { recursive: true })
	writeFileSync(join(root, 'shared', 'tsconfig.json'), '{}')

	return root
}

// --- findOwningProjectDir ---

describe('findOwningProjectDir', () => {
	test('finds tsconfig.json in the target directory', () => {
		const root = createTempMonorepo()
		const result = findOwningProjectDir(join(root, 'packages', 'app', 'src'), root)
		expect(result).toBe(join(root, 'packages', 'app', 'src'))
	})

	test('walks up to find nearest tsconfig.json', () => {
		const root = createTempMonorepo()
		// Target is packages/app/src/deep/nested — should find packages/app/src/tsconfig.json
		const result = findOwningProjectDir(join(root, 'packages', 'app', 'src', 'deep', 'nested'), root)
		expect(result).toBe(join(root, 'packages', 'app', 'src'))
	})

	test('returns null when no tsconfig found within root', () => {
		const root = createTempMonorepo()
		mkdirSync(join(root, 'empty', 'dir'), { recursive: true })
		const result = findOwningProjectDir(join(root, 'empty', 'dir', 'file'), root)
		expect(result).toBeNull()
	})

	test('does not search above rootDir', () => {
		const root = createTempMonorepo()
		// Create a tsconfig above root — should NOT be found
		const result = findOwningProjectDir(join(root, 'empty', 'dir'), root)
		expect(result).toBeNull()
	})
})

// --- resolveReferenceDirs ---

describe('resolveReferenceDirs', () => {
	test('resolves all references to absolute dirs', () => {
		const root = createTempMonorepo()
		const tsconfig: TsConfigData = {
			references: [
				{ path: '../../lib/src' },
				{ path: '../../../shared' },
			],
			paths: {},
			configDir: join(root, 'packages', 'app', 'src'),
		}

		const dirs = resolveReferenceDirs(tsconfig)
		expect(dirs.size).toBe(2)
		expect(dirs.has(join(root, 'packages', 'lib', 'src'))).toBe(true)
		expect(dirs.has(join(root, 'shared'))).toBe(true)
		// Original ref paths are preserved as values
		expect(dirs.get(join(root, 'packages', 'lib', 'src'))).toBe('../../lib/src')
		expect(dirs.get(join(root, 'shared'))).toBe('../../../shared')
	})

	test('handles empty references', () => {
		const tsconfig: TsConfigData = {
			references: [],
			paths: {},
			configDir: '/tmp',
		}
		expect(resolveReferenceDirs(tsconfig).size).toBe(0)
	})
})

// --- resolveImportTargetDirs ---

describe('resolveImportTargetDirs', () => {
	test('resolves workspace package imports to project dirs', () => {
		const root = createTempMonorepo()
		const currentDir = join(root, 'packages', 'app', 'src')

		const libPkg: WorkspacePackage = {
			name: '@scope/lib',
			dir: join(root, 'packages', 'lib'),
			packageJson: { name: '@scope/lib' },
		}

		const resolvedImports: ResolvedImport[] = [{
			packageName: '@scope/lib',
			hasSubpath: false,
			subpath: null,
			fullSpecifier: '@scope/lib',
			file: join(currentDir, 'index.ts'),
			isTypeOnly: false,
			isImportTypeExpression: false,
		}]

		const targets = resolveImportTargetDirs([], resolvedImports, [libPkg], currentDir, root)
		expect(targets.size).toBe(1)
		// lib has src/tsconfig.json so project dir is packages/lib/src/
		expect(targets.has(join(root, 'packages', 'lib', 'src'))).toBe(true)
		expect(targets.get(join(root, 'packages', 'lib', 'src'))).toBe('@scope/lib')
	})

	test('resolves workspace package without src/tsconfig to package root', () => {
		const root = createTempMonorepo()
		const currentDir = join(root, 'packages', 'app', 'src')

		const utilsPkg: WorkspacePackage = {
			name: '@scope/utils',
			dir: join(root, 'packages', 'utils'),
			packageJson: { name: '@scope/utils' },
		}

		const resolvedImports: ResolvedImport[] = [{
			packageName: '@scope/utils',
			hasSubpath: false,
			subpath: null,
			fullSpecifier: '@scope/utils',
			file: join(currentDir, 'index.ts'),
			isTypeOnly: false,
			isImportTypeExpression: false,
		}]

		const targets = resolveImportTargetDirs([], resolvedImports, [utilsPkg], currentDir, root)
		expect(targets.size).toBe(1)
		expect(targets.has(join(root, 'packages', 'utils'))).toBe(true)
	})

	test('resolves relative imports crossing tsconfig boundary', () => {
		const root = createTempMonorepo()
		const testDir = join(root, 'packages', 'app', 'test')

		const records: ImportRecord[] = [{
			specifier: '../src/utils',
			file: join(testDir, 'foo.test.ts'),
			isTypeOnly: false,
			isImportTypeExpression: false,
		}]

		const targets = resolveImportTargetDirs(records, [], [], testDir, root)
		expect(targets.size).toBe(1)
		// ../src/utils resolves to packages/app/src/ which has its own tsconfig
		expect(targets.has(join(root, 'packages', 'app', 'src'))).toBe(true)
	})

	test('skips relative imports within same project', () => {
		const root = createTempMonorepo()
		const srcDir = join(root, 'packages', 'app', 'src')

		const records: ImportRecord[] = [{
			specifier: './utils',
			file: join(srcDir, 'index.ts'),
			isTypeOnly: false,
			isImportTypeExpression: false,
		}]

		const targets = resolveImportTargetDirs(records, [], [], srcDir, root)
		expect(targets.size).toBe(0)
	})

	test('excludes self-references for workspace packages', () => {
		const root = createTempMonorepo()
		const srcDir = join(root, 'packages', 'app', 'src')

		const appPkg: WorkspacePackage = {
			name: '@scope/app',
			dir: join(root, 'packages', 'app'),
			packageJson: { name: '@scope/app' },
		}

		const resolvedImports: ResolvedImport[] = [{
			packageName: '@scope/app',
			hasSubpath: false,
			subpath: null,
			fullSpecifier: '@scope/app',
			file: join(srcDir, 'index.ts'),
			isTypeOnly: false,
			isImportTypeExpression: false,
		}]

		const targets = resolveImportTargetDirs([], resolvedImports, [appPkg], srcDir, root)
		expect(targets.size).toBe(0)
	})

	test('resolves reference to non-package directory (shared/)', () => {
		const root = createTempMonorepo()
		const srcDir = join(root, 'packages', 'app', 'src')

		const records: ImportRecord[] = [{
			specifier: '../../../shared/helpers',
			file: join(srcDir, 'index.ts'),
			isTypeOnly: false,
			isImportTypeExpression: false,
		}]

		const targets = resolveImportTargetDirs(records, [], [], srcDir, root)
		expect(targets.size).toBe(1)
		expect(targets.has(join(root, 'shared'))).toBe(true)
	})

	test('skips dot imports', () => {
		const root = createTempMonorepo()
		const srcDir = join(root, 'packages', 'app', 'src')

		const records: ImportRecord[] = [
			{ specifier: '.', file: join(srcDir, 'index.ts'), isTypeOnly: false, isImportTypeExpression: false },
			{ specifier: '..', file: join(srcDir, 'index.ts'), isTypeOnly: false, isImportTypeExpression: false },
		]

		const targets = resolveImportTargetDirs(records, [], [], srcDir, root)
		expect(targets.size).toBe(0)
	})

	test('skips non-relative, non-package imports', () => {
		const root = createTempMonorepo()
		const srcDir = join(root, 'packages', 'app', 'src')

		const records: ImportRecord[] = [{
			specifier: 'node:fs',
			file: join(srcDir, 'index.ts'),
			isTypeOnly: false,
			isImportTypeExpression: false,
		}]

		const targets = resolveImportTargetDirs(records, [], [], srcDir, root)
		expect(targets.size).toBe(0)
	})
})
