import type { DepsLintConfig } from './types.js'

export const defaultConfig: DepsLintConfig = {
	globalModules: [],
	allowedUnusedDependencies: [],
	allowedDirectoryImports: [],
	sourcePatterns: ['src/**/*.{ts,tsx}'],
	excludePatterns: ['**/*.d.ts', '**/generated/**'],
	ignoredPackages: [],
	checkDevDependencies: false,
	tsconfigPath: null,
	packageOverrides: {},
	testPatterns: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test/**'],
	bannedDependencies: {},
	enforceCatalog: [],
}
