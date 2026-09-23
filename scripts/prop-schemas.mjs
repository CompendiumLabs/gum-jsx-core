// TypeScript 7's synchronous compiler API needs Node's pipe handles (not Bun's).
// This development-only generator never enters the published runtime.
import { API, SignatureKind } from 'typescript/unstable/sync'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cwd = resolve(process.argv.find(arg => arg.startsWith('--package='))?.slice(10) ?? root)
const check = process.argv.includes('--check')
const api = new API({ cwd })
const marker = '// Generated prop registrations; run the workspace props:generate command.'
const generated = '// Generated from constructor input types. Do not edit by hand.\n'
let changed = false
function save(path, content) {
  let old = ''
  try { old = readFileSync(path, 'utf8') } catch {}
  if (old === content) return
  if (check) { console.error(`Stale prop schema: ${path}`); changed = true }
  else writeFileSync(path, content)
}
try {
  const project = api.updateSnapshot({ openProjects: [resolve(cwd, 'tsconfig.json')] }).getProjects()[0]
  const checker = project.checker
  // Follow inherited class input types, including classes with a normalized source type.
  function inputType(type) {
    for (const base of checker.getBaseTypes(type)) {
      if (checker.typeToString(base).startsWith('Element<')) return checker.getTypeArguments(base)[1]
      if (checker.typeToString(base).startsWith('MathElement<')) return checker.getTypeArguments(base)[0]
      const input = inputType(base)
      if (input) return input
    }
  }
  const commonFile = resolve(root, 'src/engine/element.ts')
  const commonSource = readFileSync(commonFile, 'utf8')
  const commonType = checker.getTypeAtPosition(commonFile, commonSource.indexOf('type ElementProps') + 5)
  const commonKeys = checker.getPropertiesOfType(commonType).map(symbol => symbol.name)
  const schemas = {}
  const files = []
  for (const name of readdirSync(resolve(cwd, 'src/elems')).sort()) {
    if (!name.endsWith('.ts') || name === 'base.ts') continue
    const path = resolve(cwd, 'src/elems', name)
    const source = readFileSync(path, 'utf8')
    const text = source.split(marker)[0].trimEnd()
    const entries = []
    for (const match of text.matchAll(/^(class|const) (\w+)(?: extends | = define_component<)/gm)) {
      const [, kind, name] = match
      const position = match.index + kind.length + 1
      const type = checker.getTypeAtPosition(path, position)
      const input = kind === 'class' ? inputType(type)
        : checker.getNonNullableType(checker.getParameterType(
          checker.getSignaturesOfType(type, SignatureKind.Construct)[0], 0))
      if (!input) throw new Error(`No input type for ${name}`)
      const keys = checker.getPropertiesOfType(input).map(symbol => symbol.name).sort()
      if (!keys.includes('children')) throw new Error(`Incomplete input schema for ${name}`)
      schemas[name] = [...new Set([...commonKeys, ...keys])].sort().join(' ')
      entries.push(name)
    }
    if (entries.length) files.push({ path, text, entries })
  }
  save(resolve(cwd, 'src/prop-schemas.ts'), generated +
    'const prop_schemas = ' + JSON.stringify(schemas, null, 2) + ' as const\n\nexport { prop_schemas }\n')
  for (const { path, text, entries } of files) {
    const core = cwd === root
    const imports = `import { register_props } from '${core ? '../engine/prop_validation' : '@gum-jsx/core'}'\n`
      + "import { prop_schemas } from '../prop-schemas'\n"
    save(path, text + '\n\n' + marker + '\n' + imports +
      entries.map(name => `register_props(${name}, prop_schemas.${name})`).join('\n') + '\n')
  }
  console.log(`${check ? 'Checked' : 'Generated'} ${Object.keys(schemas).length} prop schemas in ${cwd}`)
} finally { api.close() }
if (changed) process.exitCode = 1
