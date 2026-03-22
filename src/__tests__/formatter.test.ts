import { test, expect, describe } from 'bun:test'
import type { Diagnostic } from '../checks/types.js'
import { formatText, formatJson } from '../output/formatter.js'

function diag(overrides: Partial<Diagnostic> = {}): Diagnostic {
	return {
		type: 'missing-dependency',
		packageName: 'test-pkg',
		packageDir: '/tmp/test-pkg',
		message: 'test message',
		...overrides,
	}
}

describe('formatText', () => {
	test('groups diagnostics by package', () => {
		const diagnostics = [
			diag({ packageName: 'pkg-a', message: 'issue 1' }),
			diag({ packageName: 'pkg-b', message: 'issue 2' }),
			diag({ packageName: 'pkg-a', message: 'issue 3' }),
		]
		const output = formatText(diagnostics)
		// pkg-a appears once as a header, before pkg-b
		expect(output.indexOf('pkg-a')).toBeLessThan(output.indexOf('pkg-b'))
		expect(output.split('pkg-a').length - 1).toBe(1)
	})

	test('sorts diagnostics by type then message within a package', () => {
		const diagnostics = [
			diag({ type: 'unused-dependency', message: 'zzz' }),
			diag({ type: 'missing-dependency', message: 'aaa' }),
			diag({ type: 'missing-dependency', message: 'bbb' }),
		]
		const output = formatText(diagnostics)
		const lines = output.split('\n').filter(l => l.startsWith('  '))
		expect(lines[0]).toContain('missing-dependency')
		expect(lines[0]).toContain('aaa')
		expect(lines[1]).toContain('missing-dependency')
		expect(lines[1]).toContain('bbb')
		expect(lines[2]).toContain('unused-dependency')
	})
})

describe('formatJson', () => {
	test('serializes diagnostics as JSON array', () => {
		const d = diag({ file: '/tmp/f.ts', module: 'foo' })
		const parsed = JSON.parse(formatJson([d, diag()]))
		expect(parsed).toHaveLength(2)
		expect(parsed[0].type).toBe('missing-dependency')
		expect(parsed[0].module).toBe('foo')
	})
})
