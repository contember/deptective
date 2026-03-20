export interface DepsLintPackageConfig {
	globalModules: string[]
	allowedUnusedDependencies: string[]
	allowedDirectoryImports: string[]
	sourcePatterns: string[]
	excludePatterns: string[]
	tsconfigPath: string | null
	/** Patterns matching test files (for dev-dependency-in-source check) */
	testPatterns: string[]
	/** Dependencies that are banned from use */
	bannedDependencies: Record<string, string>
	/** Enforce catalog:/workspace: protocol in these dependency fields (opt-in) */
	enforceCatalog: ('dependencies' | 'devDependencies' | 'peerDependencies')[]
}

export interface DepsLintConfig extends DepsLintPackageConfig {
	ignoredPackages: string[]
	checkDevDependencies: boolean
	packageOverrides: Record<string, Partial<DepsLintPackageConfig>>
}
