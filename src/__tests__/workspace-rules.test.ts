import { test, expect, describe } from 'bun:test'
import type { WorkspacePackage } from '../workspace/types.js'
import { circularWorkspaceDependencyRule } from '../checks/rules/circular-workspace-dependency.js'
import { inconsistentVersionRule } from '../checks/rules/inconsistent-version.js'

function createPackage(name: string, deps: Record<string, string> = {}, peerDeps: Record<string, string> = {}): WorkspacePackage {
	return {
		name,
		dir: `/tmp/packages/${name}`,
		packageJson: {
			name,
			dependencies: deps,
			peerDependencies: peerDeps,
		},
	}
}

// --- circular-workspace-dependency ---

describe('circular-workspace-dependency', () => {
	test('reports direct circular dependency', () => {
		const packages = [
			createPackage('a', { b: 'workspace:*' }),
			createPackage('b', { a: 'workspace:*' }),
		]
		const diags = circularWorkspaceDependencyRule.check(packages)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('circular-workspace-dependency')
		expect(diags[0].message).toContain('a')
		expect(diags[0].message).toContain('b')
	})

	test('reports transitive circular dependency', () => {
		const packages = [
			createPackage('a', { b: 'workspace:*' }),
			createPackage('b', { c: 'workspace:*' }),
			createPackage('c', { a: 'workspace:*' }),
		]
		const diags = circularWorkspaceDependencyRule.check(packages)
		expect(diags).toHaveLength(1)
		expect(diags[0].message).toContain('a')
		expect(diags[0].message).toContain('b')
		expect(diags[0].message).toContain('c')
	})

	test('does not report acyclic dependencies', () => {
		const packages = [
			createPackage('a', { b: 'workspace:*' }),
			createPackage('b', { c: 'workspace:*' }),
			createPackage('c'),
		]
		expect(circularWorkspaceDependencyRule.check(packages)).toHaveLength(0)
	})

	test('ignores non-workspace dependencies in cycle detection', () => {
		const packages = [
			createPackage('a', { lodash: '^4.0.0' }),
			createPackage('b', { lodash: '^4.0.0' }),
		]
		expect(circularWorkspaceDependencyRule.check(packages)).toHaveLength(0)
	})

	test('detects cycles through peerDependencies', () => {
		const packages = [
			createPackage('a', { b: 'workspace:*' }),
			createPackage('b', {}, { a: 'workspace:*' }),
		]
		const diags = circularWorkspaceDependencyRule.check(packages)
		expect(diags).toHaveLength(1)
	})
})

// --- inconsistent-version ---

describe('inconsistent-version', () => {
	test('reports different versions of same dependency', () => {
		const packages = [
			createPackage('a', { lodash: '^4.0.0' }),
			createPackage('b', { lodash: '^3.0.0' }),
		]
		const diags = inconsistentVersionRule.check(packages)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('inconsistent-version')
		expect(diags[0].module).toBe('lodash')
		expect(diags[0].message).toContain('^4.0.0')
		expect(diags[0].message).toContain('^3.0.0')
	})

	test('does not report same version across packages', () => {
		const packages = [
			createPackage('a', { lodash: '^4.0.0' }),
			createPackage('b', { lodash: '^4.0.0' }),
		]
		expect(inconsistentVersionRule.check(packages)).toHaveLength(0)
	})

	test('ignores workspace protocol versions', () => {
		const packages = [
			createPackage('a', { lodash: '^4.0.0' }),
			createPackage('b', { lodash: 'workspace:*' }),
		]
		expect(inconsistentVersionRule.check(packages)).toHaveLength(0)
	})

	test('ignores catalog protocol versions', () => {
		const packages = [
			createPackage('a', { lodash: '^4.0.0' }),
			createPackage('b', { lodash: 'catalog:default' }),
		]
		expect(inconsistentVersionRule.check(packages)).toHaveLength(0)
	})

	test('ignores workspace packages', () => {
		const packages = [
			createPackage('a', { b: '^1.0.0' }),
			createPackage('b', {}),
		]
		// 'b' is a workspace package, so different versions shouldn't be flagged
		expect(inconsistentVersionRule.check(packages)).toHaveLength(0)
	})

	test('checks peerDependencies against each other', () => {
		const packages = [
			createPackage('a', {}, { react: '^18.0.0' }),
			createPackage('b', {}, { react: '^17.0.0' }),
		]
		const diags = inconsistentVersionRule.check(packages)
		expect(diags).toHaveLength(1)
		expect(diags[0].module).toBe('react')
	})

	test('does not compare dependencies against peerDependencies', () => {
		const packages = [
			createPackage('a', { react: '19.2.4' }),
			createPackage('b', {}, { react: '^18.0.0' }),
		]
		expect(inconsistentVersionRule.check(packages)).toHaveLength(0)
	})

	test('ignores open ranges in peerDependencies', () => {
		const packages = [
			createPackage('a', {}, { react: '19.2.4' }),
			createPackage('b', {}, { react: '>=19' }),
		]
		expect(inconsistentVersionRule.check(packages)).toHaveLength(0)
	})

	test('ignores wildcard peerDependencies', () => {
		const packages = [
			createPackage('a', {}, { react: '19.2.4' }),
			createPackage('b', {}, { react: '*' }),
		]
		expect(inconsistentVersionRule.check(packages)).toHaveLength(0)
	})
})
