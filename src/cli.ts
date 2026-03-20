#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { loadConfig } from './config/loader.js'
import { lint } from './linter.js'
import { formatText, formatJson } from './output/formatter.js'
import { applyFixes, isFixable } from './fixer.js'

const { values } = parseArgs({
	options: {
		config: { type: 'string', short: 'c' },
		filter: { type: 'string', short: 'f' },
		format: { type: 'string', default: 'text' },
		cwd: { type: 'string' },
		fix: { type: 'boolean' },
		'dry-run': { type: 'boolean' },
		help: { type: 'boolean', short: 'h' },
	},
	strict: false,
})

if (values.help) {
	console.log(`Usage: deptective [options]

Options:
  -c, --config <path>    Path to config file
  -f, --filter <name>    Only lint specific package(s)
      --format <type>    Output format: text (default), json
      --fix              Auto-fix issues where possible
      --dry-run          Show what --fix would do without writing files
      --cwd <dir>        Working directory (default: cwd)
  -h, --help             Show help`)
	process.exit(0)
}

const cwd = values.cwd as string ?? process.cwd()
const config = await loadConfig(cwd, values.config as string | undefined)
const result = await lint(cwd, config, values.filter as string | undefined)

const dryRun = values['dry-run'] as boolean | undefined
const fix = values.fix || dryRun

if (fix) {
	const fixable = result.diagnostics.filter(d => isFixable(d.type))
	if (fixable.length > 0) {
		const { fixed, actions, errors } = applyFixes(fixable, {
			allPackages: result.allPackages,
			rootDir: cwd,
			dryRun,
		})

		if (dryRun) {
			// Group actions by package
			const byPkg = new Map<string, typeof actions>()
			for (const a of actions) {
				const list = byPkg.get(a.packageName) ?? []
				list.push(a)
				byPkg.set(a.packageName, list)
			}

			for (const [pkg, pkgActions] of byPkg) {
				console.log(pkg)
				for (const a of pkgActions) {
					console.log(`  ${a.description}`)
				}
				console.log()
			}
			console.log(`Would fix ${fixed} issue(s). Run with --fix to apply.`)
		} else {
			console.log(`Fixed ${fixed} issue(s).`)
		}

		for (const err of errors) {
			console.error(`  error: ${err}`)
		}
	}

	if (dryRun) {
		process.exit(fixable.length > 0 ? 1 : 0)
	}

	// Re-lint to show remaining issues
	const after = await lint(cwd, config, values.filter as string | undefined)
	if (after.diagnostics.length === 0) {
		console.log(`Checked ${after.packageCount} package(s), no issues found.`)
		process.exit(0)
	}

	const output = (values.format as string) === 'json'
		? formatJson(after.diagnostics)
		: formatText(after.diagnostics)
	console.log(output)
	console.log(`${after.diagnostics.length} issue(s) remaining in ${after.packageCount} package(s).`)
	process.exit(1)
}

if (result.diagnostics.length === 0) {
	console.log(`Checked ${result.packageCount} package(s), no issues found.`)
	process.exit(0)
}

const output = (values.format as string) === 'json'
	? formatJson(result.diagnostics)
	: formatText(result.diagnostics)

console.log(output)
console.log(`Found ${result.diagnostics.length} issue(s) in ${result.packageCount} package(s).`)
process.exit(1)
