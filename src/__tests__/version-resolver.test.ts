import { test, expect, describe } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { WorkspacePackage } from '../workspace/types.js'
import { resolveVersionForDep, resolveDepPackageJson } from '../checks/version-resolver.js'

function createDir(dir: string) {
	mkdirSync(dir, { recursive: true })
	return dir
}

function pkg(name: string, deps?: Record<string, string>, devDeps?: Record<string, string>): WorkspacePackage {
	return {
		name,
		dir: `/tmp/${name}`,
		packageJson: {
			name,
			dependencies: deps,
			devDependencies: devDeps,
		},
	}
}

// --- resolveVersionForDep ---

describe('resolveVersionForDep', () => {
	test('returns workspace:* for workspace packages', () => {
		const index = new Map([['foo', pkg('foo')]])
		expect(resolveVersionForDep('foo', '/tmp', '/tmp', index)).toBe('workspace:*')
	})

	test('returns most common version from workspace packages', () => {
		const index = new Map([
			['a', pkg('a', { lodash: '^4.0.0' })],
			['b', pkg('b', { lodash: '^4.0.0' })],
			['c', pkg('c', { lodash: '^3.0.0' })],
		])
		expect(resolveVersionForDep('lodash', '/tmp', '/tmp', index)).toBe('^4.0.0')
	})

	test('prefers catalog: protocol over plain version', () => {
		const index = new Map([
			['a', pkg('a', { lodash: '^4.0.0' })],
			['b', pkg('b', { lodash: 'catalog:default' })],
		])
		expect(resolveVersionForDep('lodash', '/tmp', '/tmp', index)).toBe('catalog:default')
	})

	test('prefers workspace: protocol over plain version', () => {
		const index = new Map([
			['a', pkg('a', { lodash: '^4.0.0' })],
			['b', pkg('b', { lodash: 'workspace:*' })],
		])
		expect(resolveVersionForDep('lodash', '/tmp', '/tmp', index)).toBe('workspace:*')
	})

	test('reads version from node_modules in packageDir', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deptective-ver-'))
		createDir(join(dir, 'node_modules', 'foo'))
		writeFileSync(join(dir, 'node_modules', 'foo', 'package.json'), JSON.stringify({
			name: 'foo',
			version: '2.3.4',
		}))

		expect(resolveVersionForDep('foo', dir, '/tmp/root', new Map())).toBe('^2.3.4')
	})

	test('reads version from node_modules in rootDir as fallback', () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-ver-'))
		const pkgDir = mkdtempSync(join(tmpdir(), 'deptective-ver-'))

		createDir(join(root, 'node_modules', 'foo'))
		writeFileSync(join(root, 'node_modules', 'foo', 'package.json'), JSON.stringify({
			name: 'foo',
			version: '1.0.0',
		}))

		expect(resolveVersionForDep('foo', pkgDir, root, new Map())).toBe('^1.0.0')
	})

	test('returns null when version cannot be resolved', () => {
		expect(resolveVersionForDep('nonexistent', '/tmp/a', '/tmp/b', new Map())).toBeNull()
	})

	test('checks devDependencies in workspace packages', () => {
		const index = new Map([
			['a', pkg('a', undefined, { vitest: '^1.0.0' })],
		])
		expect(resolveVersionForDep('vitest', '/tmp', '/tmp', index)).toBe('^1.0.0')
	})

	test('checks peerDependencies in workspace packages', () => {
		const a: WorkspacePackage = {
			name: 'a',
			dir: '/tmp/a',
			packageJson: { name: 'a', peerDependencies: { react: '^18.0.0' } },
		}
		const index = new Map([['a', a]])
		expect(resolveVersionForDep('react', '/tmp', '/tmp', index)).toBe('^18.0.0')
	})
})

// --- resolveDepPackageJson ---

describe('resolveDepPackageJson', () => {
	test('finds package.json in packageDir/node_modules', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deptective-dep-'))
		createDir(join(dir, 'node_modules', 'foo'))
		writeFileSync(join(dir, 'node_modules', 'foo', 'package.json'), '{}')

		expect(resolveDepPackageJson('foo', '/tmp/root', dir)).toBe(join(dir, 'node_modules', 'foo', 'package.json'))
	})

	test('falls back to rootDir/node_modules', () => {
		const root = mkdtempSync(join(tmpdir(), 'deptective-dep-'))
		createDir(join(root, 'node_modules', 'foo'))
		writeFileSync(join(root, 'node_modules', 'foo', 'package.json'), '{}')

		expect(resolveDepPackageJson('foo', root, '/tmp/other')).toBe(join(root, 'node_modules', 'foo', 'package.json'))
	})

	test('returns null when not found', () => {
		expect(resolveDepPackageJson('nonexistent', '/tmp/a', '/tmp/b')).toBeNull()
	})

	test('handles scoped packages', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deptective-dep-'))
		createDir(join(dir, 'node_modules', '@scope', 'pkg'))
		writeFileSync(join(dir, 'node_modules', '@scope', 'pkg', 'package.json'), '{}')

		expect(resolveDepPackageJson('@scope/pkg', '/tmp/root', dir)).toBe(
			join(dir, 'node_modules', '@scope', 'pkg', 'package.json'),
		)
	})
})
