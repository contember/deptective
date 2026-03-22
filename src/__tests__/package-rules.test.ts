import { test, expect, describe } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CheckContext } from '../checks/types.js'
import type { ResolvedImport } from '../imports/resolver.js'
import type { ImportRecord } from '../imports/collector.js'
import { missingDependencyRule } from '../checks/rules/missing-dependency.js'
import { unusedDependencyRule } from '../checks/rules/unused-dependency.js'
import { missingReferenceRule } from '../checks/rules/missing-reference.js'
import { unusedReferenceRule } from '../checks/rules/unused-reference.js'
import { forbiddenDirectoryImportRule } from '../checks/rules/forbidden-directory-import.js'
import { forbiddenDotImportRule } from '../checks/rules/forbidden-dot-import.js'
import { selfImportRule } from '../checks/rules/self-import.js'
import { typeOnlyDependencyRule } from '../checks/rules/type-only-dependency.js'
import { devDependencyInSourceRule } from '../checks/rules/dev-dependency-in-source.js'
import { duplicateDependencyRule } from '../checks/rules/duplicate-dependency.js'
import { missingPeerDependencyRule } from '../checks/rules/missing-peer-dependency.js'
import { bannedDependencyRule } from '../checks/rules/banned-dependency.js'
import { dynamicTypeImportRule } from '../checks/rules/dynamic-type-import.js'
import { enforceCatalogRule } from '../checks/rules/enforce-catalog.js'

function createContext(overrides: Partial<CheckContext> = {}): CheckContext {
	return {
		packageName: 'test-pkg',
		packageDir: '/tmp/test-pkg',
		rootDir: '/tmp',
		importedPackages: new Set(),
		resolvedImports: [],
		dotImports: [],
		allWorkspaceNames: new Set(),
		referencedPackageNames: new Set(),
		hasTsConfig: false,
		dependencies: {},
		peerDependencies: {},
		devDependencies: {},
		config: {
			globalModules: [],
			allowedUnusedDependencies: [],
			allowedDirectoryImports: [],
			sourcePatterns: ['src/**/*.ts'],
			excludePatterns: ['**/node_modules/**'],
			tsconfigPath: null,
			testPatterns: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
			bannedDependencies: {},
			enforceCatalog: [],
		},
		...overrides,
	}
}

function createImport(overrides: Partial<ResolvedImport> = {}): ResolvedImport {
	return {
		packageName: 'some-pkg',
		hasSubpath: false,
		subpath: null,
		fullSpecifier: 'some-pkg',
		file: '/tmp/test-pkg/src/index.ts',
		isTypeOnly: false,
		isImportTypeExpression: false,
		...overrides,
	}
}

// --- missing-dependency ---

describe('missing-dependency', () => {
	test('reports imported module not in any dependency field', () => {
		const ctx = createContext({ importedPackages: new Set(['foo']) })
		const diags = missingDependencyRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('missing-dependency')
		expect(diags[0].module).toBe('foo')
	})

	test('does not report if in dependencies', () => {
		const ctx = createContext({
			importedPackages: new Set(['foo']),
			dependencies: { foo: '^1.0.0' },
		})
		expect(missingDependencyRule.check(ctx)).toHaveLength(0)
	})

	test('does not report if in peerDependencies', () => {
		const ctx = createContext({
			importedPackages: new Set(['foo']),
			peerDependencies: { foo: '^1.0.0' },
		})
		expect(missingDependencyRule.check(ctx)).toHaveLength(0)
	})

	test('does not report if in devDependencies', () => {
		const ctx = createContext({
			importedPackages: new Set(['foo']),
			devDependencies: { foo: '^1.0.0' },
		})
		expect(missingDependencyRule.check(ctx)).toHaveLength(0)
	})

	test('does not report global modules', () => {
		const ctx = createContext({
			importedPackages: new Set(['foo']),
			config: {
				...createContext().config,
				globalModules: ['foo'],
			},
		})
		expect(missingDependencyRule.check(ctx)).toHaveLength(0)
	})
})

// --- unused-dependency ---

describe('unused-dependency', () => {
	test('reports dependency not imported', () => {
		const ctx = createContext({ dependencies: { foo: '^1.0.0' } })
		const diags = unusedDependencyRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('unused-dependency')
		expect(diags[0].module).toBe('foo')
	})

	test('does not report if imported', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			importedPackages: new Set(['foo']),
		})
		expect(unusedDependencyRule.check(ctx)).toHaveLength(0)
	})

	test('does not report allowed unused dependencies', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			config: { ...createContext().config, allowedUnusedDependencies: ['foo'] },
		})
		expect(unusedDependencyRule.check(ctx)).toHaveLength(0)
	})
})

// --- missing-reference ---

describe('missing-reference', () => {
	test('reports workspace package imported but not referenced', () => {
		const ctx = createContext({
			hasTsConfig: true,
			importedPackages: new Set(['@scope/lib']),
			allWorkspaceNames: new Set(['@scope/lib']),
		})
		const diags = missingReferenceRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('missing-reference')
		expect(diags[0].module).toBe('@scope/lib')
	})

	test('does not report if already referenced', () => {
		const ctx = createContext({
			hasTsConfig: true,
			importedPackages: new Set(['@scope/lib']),
			allWorkspaceNames: new Set(['@scope/lib']),
			referencedPackageNames: new Set(['@scope/lib']),
		})
		expect(missingReferenceRule.check(ctx)).toHaveLength(0)
	})

	test('does not report if no tsconfig', () => {
		const ctx = createContext({
			hasTsConfig: false,
			importedPackages: new Set(['@scope/lib']),
			allWorkspaceNames: new Set(['@scope/lib']),
		})
		expect(missingReferenceRule.check(ctx)).toHaveLength(0)
	})

	test('does not report non-workspace packages', () => {
		const ctx = createContext({
			hasTsConfig: true,
			importedPackages: new Set(['lodash']),
			allWorkspaceNames: new Set(),
		})
		expect(missingReferenceRule.check(ctx)).toHaveLength(0)
	})
})

// --- unused-reference ---

describe('unused-reference', () => {
	test('reports reference not imported', () => {
		const ctx = createContext({
			hasTsConfig: true,
			referencedPackageNames: new Set(['@scope/lib']),
		})
		const diags = unusedReferenceRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('unused-reference')
		expect(diags[0].module).toBe('@scope/lib')
	})

	test('does not report if imported', () => {
		const ctx = createContext({
			hasTsConfig: true,
			referencedPackageNames: new Set(['@scope/lib']),
			importedPackages: new Set(['@scope/lib']),
		})
		expect(unusedReferenceRule.check(ctx)).toHaveLength(0)
	})

	test('does not report if no tsconfig', () => {
		const ctx = createContext({
			hasTsConfig: false,
			referencedPackageNames: new Set(['@scope/lib']),
		})
		expect(unusedReferenceRule.check(ctx)).toHaveLength(0)
	})
})

// --- forbidden-directory-import ---

describe('forbidden-directory-import', () => {
	test('reports subpath imports', () => {
		const ctx = createContext({
			resolvedImports: [createImport({
				packageName: 'foo',
				hasSubpath: true,
				subpath: '/internal',
				fullSpecifier: 'foo/internal',
			})],
		})
		const diags = forbiddenDirectoryImportRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('forbidden-directory-import')
		expect(diags[0].module).toBe('foo/internal')
	})

	test('does not report imports without subpath', () => {
		const ctx = createContext({
			resolvedImports: [createImport({ hasSubpath: false, subpath: null })],
		})
		expect(forbiddenDirectoryImportRule.check(ctx)).toHaveLength(0)
	})

	test('does not report allowed directory imports', () => {
		const ctx = createContext({
			resolvedImports: [createImport({
				hasSubpath: true,
				subpath: '/client',
				fullSpecifier: 'foo/client',
			})],
			config: { ...createContext().config, allowedDirectoryImports: ['foo/client'] },
		})
		expect(forbiddenDirectoryImportRule.check(ctx)).toHaveLength(0)
	})

	test('does not report if subpath is exported', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deptective-'))
		mkdirSync(join(dir, 'node_modules', 'foo'), { recursive: true })
		writeFileSync(join(dir, 'node_modules', 'foo', 'package.json'), JSON.stringify({
			name: 'foo',
			exports: { '.': './index.js', './client': './client.js' },
		}))

		const ctx = createContext({
			rootDir: dir,
			resolvedImports: [createImport({
				packageName: 'foo',
				hasSubpath: true,
				subpath: '/client',
				fullSpecifier: 'foo/client',
			})],
		})
		expect(forbiddenDirectoryImportRule.check(ctx)).toHaveLength(0)
	})
})

// --- forbidden-dot-import ---

describe('forbidden-dot-import', () => {
	test('reports dot imports', () => {
		const dotImport: ImportRecord = {
			specifier: '.',
			file: '/tmp/test-pkg/src/index.ts',
			isTypeOnly: false,
			isImportTypeExpression: false,
		}
		const ctx = createContext({ dotImports: [dotImport] })
		const diags = forbiddenDotImportRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('forbidden-dot-import')
	})

	test('reports no diagnostics when no dot imports', () => {
		const ctx = createContext({ dotImports: [] })
		expect(forbiddenDotImportRule.check(ctx)).toHaveLength(0)
	})
})

// --- self-import ---

describe('self-import', () => {
	test('reports package importing itself', () => {
		const ctx = createContext({
			packageName: 'my-pkg',
			resolvedImports: [createImport({ packageName: 'my-pkg', fullSpecifier: 'my-pkg' })],
		})
		const diags = selfImportRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('self-import')
	})

	test('does not report imports of other packages', () => {
		const ctx = createContext({
			packageName: 'my-pkg',
			resolvedImports: [createImport({ packageName: 'other-pkg' })],
		})
		expect(selfImportRule.check(ctx)).toHaveLength(0)
	})
})

// --- type-only-dependency ---

describe('type-only-dependency', () => {
	test('reports dependency used only as import type', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			resolvedImports: [
				createImport({ packageName: 'foo', isTypeOnly: true }),
			],
		})
		const diags = typeOnlyDependencyRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('type-only-dependency')
		expect(diags[0].module).toBe('foo')
	})

	test('does not report if any value import exists', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			resolvedImports: [
				createImport({ packageName: 'foo', isTypeOnly: true }),
				createImport({ packageName: 'foo', isTypeOnly: false }),
			],
		})
		expect(typeOnlyDependencyRule.check(ctx)).toHaveLength(0)
	})

	test('does not report if not in dependencies', () => {
		const ctx = createContext({
			devDependencies: { foo: '^1.0.0' },
			resolvedImports: [
				createImport({ packageName: 'foo', isTypeOnly: true }),
			],
		})
		expect(typeOnlyDependencyRule.check(ctx)).toHaveLength(0)
	})
})

// --- dev-dependency-in-source ---

describe('dev-dependency-in-source', () => {
	test('reports devDependency imported in production source', () => {
		const ctx = createContext({
			packageDir: '/tmp/test-pkg',
			devDependencies: { vitest: '^1.0.0' },
			resolvedImports: [createImport({
				packageName: 'vitest',
				fullSpecifier: 'vitest',
				file: '/tmp/test-pkg/src/utils.ts',
			})],
		})
		const diags = devDependencyInSourceRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('dev-dependency-in-source')
		expect(diags[0].module).toBe('vitest')
	})

	test('does not report in test files', () => {
		const ctx = createContext({
			packageDir: '/tmp/test-pkg',
			devDependencies: { vitest: '^1.0.0' },
			resolvedImports: [createImport({
				packageName: 'vitest',
				file: '/tmp/test-pkg/src/utils.test.ts',
			})],
		})
		expect(devDependencyInSourceRule.check(ctx)).toHaveLength(0)
	})

	test('does not report type-only imports', () => {
		const ctx = createContext({
			devDependencies: { foo: '^1.0.0' },
			resolvedImports: [createImport({
				packageName: 'foo',
				file: '/tmp/test-pkg/src/utils.ts',
				isTypeOnly: true,
			})],
		})
		expect(devDependencyInSourceRule.check(ctx)).toHaveLength(0)
	})

	test('does not report config files', () => {
		const ctx = createContext({
			packageDir: '/tmp/test-pkg',
			devDependencies: { vite: '^5.0.0' },
			resolvedImports: [createImport({
				packageName: 'vite',
				file: '/tmp/test-pkg/vite.config.ts',
			})],
		})
		expect(devDependencyInSourceRule.check(ctx)).toHaveLength(0)
	})

	test('does not report if also in dependencies', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			devDependencies: { foo: '^1.0.0' },
			resolvedImports: [createImport({
				packageName: 'foo',
				file: '/tmp/test-pkg/src/index.ts',
			})],
		})
		expect(devDependencyInSourceRule.check(ctx)).toHaveLength(0)
	})
})

// --- duplicate-dependency ---

describe('duplicate-dependency', () => {
	test('reports dep in both dependencies and peerDependencies', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			peerDependencies: { foo: '^1.0.0' },
		})
		const diags = duplicateDependencyRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].message).toContain('peerDependencies')
	})

	test('reports dep in both dependencies and devDependencies', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			devDependencies: { foo: '^1.0.0' },
		})
		const diags = duplicateDependencyRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].message).toContain('devDependencies')
	})

	test('does not report unique dependencies', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			devDependencies: { bar: '^1.0.0' },
		})
		expect(duplicateDependencyRule.check(ctx)).toHaveLength(0)
	})
})

// --- missing-peer-dependency ---

describe('missing-peer-dependency', () => {
	test('reports missing required peer dependency', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deptective-'))
		mkdirSync(join(dir, 'node_modules', 'bar'), { recursive: true })
		writeFileSync(join(dir, 'node_modules', 'bar', 'package.json'), JSON.stringify({
			name: 'bar',
			peerDependencies: { 'peer-pkg': '^1.0.0' },
		}))

		const ctx = createContext({
			packageDir: dir,
			rootDir: dir,
			dependencies: { bar: '^1.0.0' },
		})
		const diags = missingPeerDependencyRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('missing-peer-dependency')
		expect(diags[0].module).toBe('peer-pkg')
	})

	test('does not report optional peer dependencies', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deptective-'))
		mkdirSync(join(dir, 'node_modules', 'bar'), { recursive: true })
		writeFileSync(join(dir, 'node_modules', 'bar', 'package.json'), JSON.stringify({
			name: 'bar',
			peerDependencies: { 'peer-pkg': '^1.0.0' },
			peerDependenciesMeta: { 'peer-pkg': { optional: true } },
		}))

		const ctx = createContext({
			packageDir: dir,
			rootDir: dir,
			dependencies: { bar: '^1.0.0' },
		})
		expect(missingPeerDependencyRule.check(ctx)).toHaveLength(0)
	})

	test('does not report if peer dependency is installed', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deptective-'))
		mkdirSync(join(dir, 'node_modules', 'bar'), { recursive: true })
		writeFileSync(join(dir, 'node_modules', 'bar', 'package.json'), JSON.stringify({
			name: 'bar',
			peerDependencies: { 'peer-pkg': '^1.0.0' },
		}))
		mkdirSync(join(dir, 'node_modules', 'peer-pkg'), { recursive: true })
		writeFileSync(join(dir, 'node_modules', 'peer-pkg', 'package.json'), JSON.stringify({
			name: 'peer-pkg',
		}))

		const ctx = createContext({
			packageDir: dir,
			rootDir: dir,
			dependencies: { bar: '^1.0.0' },
		})
		expect(missingPeerDependencyRule.check(ctx)).toHaveLength(0)
	})
})

// --- banned-dependency ---

describe('banned-dependency', () => {
	test('reports banned dependency import', () => {
		const ctx = createContext({
			resolvedImports: [createImport({ packageName: 'moment' })],
			config: {
				...createContext().config,
				bannedDependencies: { moment: 'Use dayjs instead' },
			},
		})
		const diags = bannedDependencyRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('banned-dependency')
		expect(diags[0].message).toContain('Use dayjs instead')
	})

	test('does not report non-banned dependencies', () => {
		const ctx = createContext({
			resolvedImports: [createImport({ packageName: 'dayjs' })],
			config: {
				...createContext().config,
				bannedDependencies: { moment: 'Use dayjs instead' },
			},
		})
		expect(bannedDependencyRule.check(ctx)).toHaveLength(0)
	})
})

// --- dynamic-type-import ---

describe('dynamic-type-import', () => {
	test('reports import() in type position', () => {
		const ctx = createContext({
			resolvedImports: [createImport({
				fullSpecifier: 'foo',
				isImportTypeExpression: true,
			})],
		})
		const diags = dynamicTypeImportRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('dynamic-type-import')
	})

	test('does not report regular imports', () => {
		const ctx = createContext({
			resolvedImports: [createImport({ isImportTypeExpression: false })],
		})
		expect(dynamicTypeImportRule.check(ctx)).toHaveLength(0)
	})
})

// --- enforce-catalog ---

describe('enforce-catalog', () => {
	test('reports dependencies not using catalog: or workspace: protocol', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			config: {
				...createContext().config,
				enforceCatalog: ['dependencies'],
			},
		})
		const diags = enforceCatalogRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].type).toBe('enforce-catalog')
		expect(diags[0].module).toBe('foo')
	})

	test('does not report catalog: protocol', () => {
		const ctx = createContext({
			dependencies: { foo: 'catalog:default' },
			config: {
				...createContext().config,
				enforceCatalog: ['dependencies'],
			},
		})
		expect(enforceCatalogRule.check(ctx)).toHaveLength(0)
	})

	test('does not report workspace: protocol', () => {
		const ctx = createContext({
			dependencies: { foo: 'workspace:*' },
			config: {
				...createContext().config,
				enforceCatalog: ['dependencies'],
			},
		})
		expect(enforceCatalogRule.check(ctx)).toHaveLength(0)
	})

	test('does nothing when enforceCatalog is empty', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
		})
		expect(enforceCatalogRule.check(ctx)).toHaveLength(0)
	})

	test('checks only specified dependency fields', () => {
		const ctx = createContext({
			dependencies: { foo: '^1.0.0' },
			devDependencies: { bar: '^2.0.0' },
			config: {
				...createContext().config,
				enforceCatalog: ['devDependencies'],
			},
		})
		const diags = enforceCatalogRule.check(ctx)
		expect(diags).toHaveLength(1)
		expect(diags[0].module).toBe('bar')
	})
})
