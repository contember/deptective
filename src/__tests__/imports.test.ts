import { test, expect, describe } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectImports } from '../imports/collector.js'
import { resolveImports } from '../imports/resolver.js'

function createPkg(files: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), 'deptective-imp-'))
	const src = join(dir, 'src')
	mkdirSync(src, { recursive: true })
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(src, name), content.trim() + '\n')
	}
	return dir
}

// --- collectImports ---

describe('collectImports', () => {
	test('collects import declarations', async () => {
		const dir = createPkg({ 'index.ts': `import { foo } from 'foo-pkg'` })
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(1)
		expect(records[0].specifier).toBe('foo-pkg')
		expect(records[0].isTypeOnly).toBe(false)
	})

	test('collects type-only imports', async () => {
		const dir = createPkg({ 'index.ts': `import type { Foo } from 'foo-pkg'` })
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(1)
		expect(records[0].isTypeOnly).toBe(true)
	})

	test('collects export from declarations', async () => {
		const dir = createPkg({ 'index.ts': `export { foo } from 'foo-pkg'` })
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(1)
		expect(records[0].specifier).toBe('foo-pkg')
	})

	test('collects type-only export from', async () => {
		const dir = createPkg({ 'index.ts': `export type { Foo } from 'foo-pkg'` })
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(1)
		expect(records[0].isTypeOnly).toBe(true)
	})

	test('collects dynamic imports', async () => {
		const dir = createPkg({ 'index.ts': `const m = await import('dynamic-pkg')` })
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(1)
		expect(records[0].specifier).toBe('dynamic-pkg')
		expect(records[0].isTypeOnly).toBe(false)
	})

	test('collects require calls', async () => {
		const dir = createPkg({ 'index.ts': `const m = require('cjs-pkg')` })
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(1)
		expect(records[0].specifier).toBe('cjs-pkg')
	})

	test('collects import() in type position', async () => {
		const dir = createPkg({ 'index.ts': `type X = import('type-pkg').SomeType` })
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(1)
		expect(records[0].specifier).toBe('type-pkg')
		expect(records[0].isTypeOnly).toBe(true)
		expect(records[0].isImportTypeExpression).toBe(true)
	})

	test('collects relative imports', async () => {
		const dir = createPkg({
			'index.ts': `import { x } from './utils'`,
			'utils.ts': `export const x = 1`,
		})
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		const relImport = records.find(r => r.specifier === './utils')
		expect(relImport).toBeDefined()
	})

	test('collects multiple imports from one file', async () => {
		const dir = createPkg({
			'index.ts': `
				import { a } from 'pkg-a'
				import { b } from 'pkg-b'
				import type { C } from 'pkg-c'
			`,
		})
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(3)
	})

	test('collects from multiple files', async () => {
		const dir = createPkg({
			'a.ts': `import { x } from 'pkg-x'`,
			'b.ts': `import { y } from 'pkg-y'`,
		})
		const records = await collectImports(dir, ['src/**/*.ts'], [])
		expect(records).toHaveLength(2)
	})

	test('excludes files matching exclude patterns', async () => {
		const dir = createPkg({
			'index.ts': `import { x } from 'pkg-x'`,
			'gen.generated.ts': `import { y } from 'pkg-y'`,
		})
		const records = await collectImports(dir, ['src/**/*.ts'], ['**/generated/**', '**/*.generated.*'])
		const specifiers = records.map(r => r.specifier)
		expect(specifiers).toContain('pkg-x')
	})

})

// --- resolveImports ---

describe('resolveImports', () => {
	test('resolves package imports', () => {
		const records = [
			{ specifier: 'lodash', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved, dotImports } = resolveImports(records, {})
		expect(resolved).toHaveLength(1)
		expect(resolved[0].packageName).toBe('lodash')
		expect(resolved[0].hasSubpath).toBe(false)
		expect(dotImports).toHaveLength(0)
	})

	test('resolves scoped package imports', () => {
		const records = [
			{ specifier: '@scope/pkg', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved } = resolveImports(records, {})
		expect(resolved).toHaveLength(1)
		expect(resolved[0].packageName).toBe('@scope/pkg')
	})

	test('resolves subpath imports', () => {
		const records = [
			{ specifier: 'lodash/get', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved } = resolveImports(records, {})
		expect(resolved).toHaveLength(1)
		expect(resolved[0].packageName).toBe('lodash')
		expect(resolved[0].hasSubpath).toBe(true)
		expect(resolved[0].subpath).toBe('/get')
		expect(resolved[0].fullSpecifier).toBe('lodash/get')
	})

	test('resolves scoped package with subpath', () => {
		const records = [
			{ specifier: '@mui/material/Button', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved } = resolveImports(records, {})
		expect(resolved).toHaveLength(1)
		expect(resolved[0].packageName).toBe('@mui/material')
		expect(resolved[0].subpath).toBe('/Button')
	})

	test('skips node: builtins', () => {
		const records = [
			{ specifier: 'node:fs', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
			{ specifier: 'node:path', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved } = resolveImports(records, {})
		expect(resolved).toHaveLength(0)
	})

	test('skips bun: builtins', () => {
		const records = [
			{ specifier: 'bun:test', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
			{ specifier: 'bun', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved } = resolveImports(records, {})
		expect(resolved).toHaveLength(0)
	})

	test('skips relative imports (except dot)', () => {
		const records = [
			{ specifier: './utils', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
			{ specifier: '../lib', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved, dotImports } = resolveImports(records, {})
		expect(resolved).toHaveLength(0)
		expect(dotImports).toHaveLength(0)
	})

	test('captures dot imports', () => {
		const records = [
			{ specifier: '.', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
			{ specifier: '..', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved, dotImports } = resolveImports(records, {})
		expect(resolved).toHaveLength(0)
		expect(dotImports).toHaveLength(2)
	})

	test('skips tsconfig path aliases (exact)', () => {
		const records = [
			{ specifier: '@/utils', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved } = resolveImports(records, { '@/utils': ['./src/utils'] })
		expect(resolved).toHaveLength(0)
	})

	test('skips tsconfig path aliases (wildcard)', () => {
		const records = [
			{ specifier: '@/components/Button', file: '/tmp/src/index.ts', isTypeOnly: false, isImportTypeExpression: false },
		]
		const { resolved } = resolveImports(records, { '@/*': ['./src/*'] })
		expect(resolved).toHaveLength(0)
	})

})
