export interface WorkspacePackage {
	name: string
	dir: string
	packageJson: PackageManifest
}

export interface PackageManifest {
	name: string
	dependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}
