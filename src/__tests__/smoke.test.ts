import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lint } from '../linter.js'
import { defaultConfig } from '../config/defaults.js'

test('lint returns empty diagnostics for empty package', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'deptective-'))
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-pkg' }))

	const result = await lint(dir, defaultConfig)
	expect(result.diagnostics).toEqual([])
	expect(result.packageCount).toBe(1)
})
