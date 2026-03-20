import glob from 'fast-glob'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import type { WorkspacePackage } from './types.js'

export async function resolveWorkspacePackages(rootDir: string): Promise<WorkspacePackage[]> {
	const patterns = await resolveWorkspacePatterns(rootDir)

	if (patterns === null) {
		// Single-package repo
		const pkgPath = path.join(rootDir, 'package.json')
		if (!existsSync(pkgPath)) {
			throw new Error(`No package.json found in ${rootDir}`)
		}
		const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
		return [{ name: pkg.name, dir: rootDir, packageJson: pkg }]
	}

	const dirs = await glob(patterns.map(p => path.join(rootDir, p)), { onlyDirectories: true, absolute: true })
	const packages: WorkspacePackage[] = []

	for (const dir of dirs.sort()) {
		const pkgPath = path.join(dir, 'package.json')
		if (!existsSync(pkgPath)) continue
		const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
		if (!pkg.name) continue
		packages.push({ name: pkg.name, dir, packageJson: pkg })
	}

	return packages
}

async function resolveWorkspacePatterns(rootDir: string): Promise<string[] | null> {
	// Try pnpm-workspace.yaml first
	const pnpmPath = path.join(rootDir, 'pnpm-workspace.yaml')
	if (existsSync(pnpmPath)) {
		const content = await fs.readFile(pnpmPath, 'utf-8')
		return parsePnpmWorkspace(content)
	}

	// Then try package.json workspaces
	const pkgPath = path.join(rootDir, 'package.json')
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
		if (Array.isArray(pkg.workspaces)) {
			return pkg.workspaces
		}
		if (pkg.workspaces?.packages && Array.isArray(pkg.workspaces.packages)) {
			return pkg.workspaces.packages
		}
	}

	return null
}

function parsePnpmWorkspace(content: string): string[] {
	const patterns: string[] = []
	let inPackages = false
	for (const line of content.split('\n')) {
		const trimmed = line.trim()
		if (trimmed === 'packages:') {
			inPackages = true
			continue
		}
		if (inPackages) {
			if (!trimmed.startsWith('-')) {
				break
			}
			const value = trimmed.replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '')
			if (value && !value.startsWith('!')) {
				patterns.push(value)
			}
		}
	}
	return patterns
}
