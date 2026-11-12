import glob from 'fast-glob'
import * as fs from 'node:fs/promises'
import ts from 'typescript'

export interface ImportRecord {
	specifier: string
	file: string
	isTypeOnly: boolean
	/** import('Foo').Bar in type position */
	isImportTypeExpression: boolean
}

export async function collectImports(packageDir: string, sourcePatterns: string[], excludePatterns: string[]): Promise<ImportRecord[]> {
	const patterns = sourcePatterns.map(p => `${packageDir}/${p}`)
	const ignore = excludePatterns.map(p => `${packageDir}/${p}`)
	const files = await glob(patterns, { onlyFiles: true, ignore })

	const records: ImportRecord[] = []

	await Promise.all(files.map(async file => {
		const content = await fs.readFile(file, 'utf-8')
		const sourceFiles = file.endsWith('.astro')
			? astroCodeSections(content).map(code => ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS))
			: [ts.createSourceFile(file, content, ts.ScriptTarget.ESNext)]

		const visit = (node: ts.Node) => {
			// import ... from 'specifier'  /  import type ... from 'specifier'
			if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				records.push({
					specifier: node.moduleSpecifier.text,
					file,
					isTypeOnly: node.importClause?.isTypeOnly ?? false,
					isImportTypeExpression: false,
				})
			}
			// export ... from 'specifier'  /  export type ... from 'specifier'
			if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				records.push({
					specifier: node.moduleSpecifier.text,
					file,
					isTypeOnly: node.isTypeOnly,
					isImportTypeExpression: false,
				})
			}
			// import('Foo').Bar in type position
			if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
				records.push({
					specifier: node.argument.literal.text,
					file,
					isTypeOnly: true,
					isImportTypeExpression: true,
				})
			}
			// dynamic import('specifier') and require('specifier')
			if (ts.isCallExpression(node)) {
				const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
				const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'

				if ((isDynamicImport || isRequire) && node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0])) {
					records.push({
						specifier: node.arguments[0].text,
						file,
						isTypeOnly: false,
						isImportTypeExpression: false,
					})
				}
			}
			ts.forEachChild(node, visit)
		}
		for (const sourceFile of sourceFiles) ts.forEachChild(sourceFile, visit)
	}))

	return records
}

/**
 * The parts of an Astro component that hold module code: the frontmatter and the body of each `<script>`
 * that Astro bundles. The markup is left out, because parsing it as TypeScript misreads JSX-like
 * expressions and prose.
 */
function astroCodeSections(content: string): string[] {
	const sections: string[] = []
	const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
	const start = lines.findIndex(line => line.trim() !== '')
	let templateStart = 0
	if (start !== -1 && lines[start]?.trim() === '---') {
		const end = lines.findIndex((line, i) => i > start && line.trim() === '---')
		// Without a closing fence, Astro reads the rest of the file as frontmatter.
		const frontmatterEnd = end === -1 ? lines.length : end
		sections.push(lines.slice(start + 1, frontmatterEnd).join('\n'))
		templateStart = frontmatterEnd + 1
	}
	const template = lines.slice(templateStart).join('\n')
	// One scan, so a `<!--` inside a script is script text, and a script inside a comment is skipped.
	// The open tag is lowercase only (`<Script>` is a component) and may self-close; the closing tag is any case.
	const scripts = /<!--[\s\S]*?-->|<script(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*?)(?:\/>|>([\s\S]*?)<\/[sS][cC][rR][iI][pP][tT]\s*>)/g
	for (const [, attributes, body] of template.matchAll(scripts)) {
		// Astro bundles a body only without attributes: with `src` it bundles the file, any other attribute makes it inline.
		if (body !== undefined && attributes?.trim() === '') sections.push(body)
	}
	return sections
}
