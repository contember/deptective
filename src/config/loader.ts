import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { defaultConfig } from './defaults.js'
import type { DepsLintConfig } from './types.js'

const CONFIG_FILES = [
	'deptective.config.ts',
	'deptective.config.js',
	'deptective.config.json',
]

export async function loadConfig(cwd: string, configPath?: string): Promise<DepsLintConfig> {
	const raw = configPath
		? await loadFromFile(path.resolve(cwd, configPath))
		: await autoLoadConfig(cwd)

	return mergeConfig(defaultConfig, raw ?? {})
}

async function autoLoadConfig(cwd: string): Promise<Partial<DepsLintConfig> | null> {
	for (const file of CONFIG_FILES) {
		const filePath = path.join(cwd, file)
		if (existsSync(filePath)) {
			return loadFromFile(filePath)
		}
	}

	const pkgPath = path.join(cwd, 'package.json')
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
		if (pkg.deptective) {
			return pkg.deptective
		}
	}

	return null
}

async function loadFromFile(filePath: string): Promise<Partial<DepsLintConfig>> {
	if (filePath.endsWith('.json')) {
		return JSON.parse(await fs.readFile(filePath, 'utf-8'))
	}
	const mod = await import(filePath)
	return mod.default ?? mod
}

function mergeConfig(defaults: DepsLintConfig, overrides: Partial<DepsLintConfig>): DepsLintConfig {
	return {
		...defaults,
		...overrides,
		packageOverrides: { ...defaults.packageOverrides, ...overrides.packageOverrides },
	}
}
