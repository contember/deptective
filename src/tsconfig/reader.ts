import JSON5 from 'json5'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync } from 'node:fs'

export interface TsConfigData {
	references: { path: string }[]
	paths: Record<string, string[]>
	configDir: string
}

const DEFAULT_TSCONFIG_LOCATIONS = ['src/tsconfig.json', 'tsconfig.json']

export async function readTsConfig(packageDir: string, configPath: string | null): Promise<TsConfigData | null> {
	const resolved = configPath
		? path.resolve(packageDir, configPath)
		: findTsConfig(packageDir)

	if (!resolved) return null

	const data = await readAndMerge(resolved)
	return {
		references: data.references ?? [],
		paths: data.compilerOptions?.paths ?? {},
		configDir: path.dirname(resolved),
	}
}

function findTsConfig(packageDir: string): string | null {
	for (const loc of DEFAULT_TSCONFIG_LOCATIONS) {
		const full = path.join(packageDir, loc)
		if (existsSync(full)) return full
	}
	return null
}

interface RawTsConfig {
	extends?: string | string[]
	compilerOptions?: { paths?: Record<string, string[]> }
	references?: { path: string }[]
}

async function readAndMerge(configPath: string): Promise<RawTsConfig> {
	const content = await fs.readFile(configPath, 'utf-8')
	const config: RawTsConfig = JSON5.parse(content)
	const configDir = path.dirname(configPath)

	if (!config.extends) return config

	const extendsList = Array.isArray(config.extends) ? config.extends : [config.extends]
	let merged: RawTsConfig = {}

	for (const ext of extendsList) {
		const extPath = resolveExtends(ext, configDir)
		if (extPath && existsSync(extPath)) {
			const parent = await readAndMerge(extPath)
			merged = mergeTsConfigs(merged, parent)
		}
	}

	return mergeTsConfigs(merged, config)
}

function resolveExtends(ext: string, fromDir: string): string | null {
	if (ext.startsWith('.')) {
		const resolved = path.resolve(fromDir, ext)
		if (existsSync(resolved) && !existsSync(path.join(resolved, 'package.json'))) {
			// It's a file
			return resolved
		}
		// Try with .json extension
		if (existsSync(resolved + '.json')) return resolved + '.json'
		// Try as directory with tsconfig.json
		if (existsSync(path.join(resolved, 'tsconfig.json'))) return path.join(resolved, 'tsconfig.json')
		return resolved
	}

	// Node module resolution — look for the package in node_modules
	try {
		return require.resolve(ext, { paths: [fromDir] })
	} catch {
		return null
	}
}

function mergeTsConfigs(base: RawTsConfig, override: RawTsConfig): RawTsConfig {
	return {
		compilerOptions: {
			...base.compilerOptions,
			...override.compilerOptions,
			paths: {
				...base.compilerOptions?.paths,
				...override.compilerOptions?.paths,
			},
		},
		references: override.references ?? base.references,
	}
}
