/**
 * Writes src/editor/sources.generated.ts: the TypeScript source of every built-in node type, macro
 * and helper, for the editor's source viewer. The published bundle holds no readable source, so it
 * is copied out of src/ here.
 *
 *   node scripts/extract-sources.mjs          write the file
 *   node scripts/extract-sources.mjs --check  fail if the file on disk is out of date
 *
 * What is found:
 * - `export const x = defineNode({ type: 'x', ... })` and the same with `defineMacro`;
 * - `export const x = factory('x', ...)`, where `factory` is a function in the same file that calls
 *   `defineNode` or `defineMacro` with a type it is given. The factory's source is included too;
 * - each helper named in src/util/helper-docs.ts, as the function it points at in src/util/.
 * Each comes with the comment directly above it and the lines it spans.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const ROOT = new URL('../', import.meta.url);
const OUTPUT = 'src/editor/sources.generated.ts';

/** @param {string} path Relative to the repository. */
function parse(path) {
  const text = readFileSync(new URL(path, ROOT), 'utf8');
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
}

/**
 * A top-level statement as shown to a reader: its text, with the comment directly above it.
 * @param {ts.SourceFile} file
 * @param {ts.Node} node
 * @param {string} [label]
 */
function part(file, node, label) {
  const text = file.text;
  let start = node.getStart(file);
  const comments = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const last = comments[comments.length - 1];
  // Only a comment that touches the statement: no blank line between them.
  if (last && !/\n\s*\n/.test(text.slice(last.end, start))) start = last.pos;
  const line = file.getLineAndCharacterOfPosition(start).line + 1;
  const endLine = file.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return {
    ...(label ? { label } : {}),
    file: file.fileName,
    line,
    endLine,
    code: text.slice(start, node.getEnd()),
  };
}

/** @param {ts.Node} node */
const isDefineCall = (node) =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  (node.expression.text === 'defineNode' || node.expression.text === 'defineMacro');

/**
 * The `type` a define call is given: its text when written as a literal, null when it is a variable.
 * @param {ts.CallExpression} call
 */
function literalType(call) {
  const argument = call.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
  for (const property of argument.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText() === 'type' &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return null;
}

/**
 * Whether a function's body calls defineNode or defineMacro.
 * @param {ts.Node} node
 */
function containsDefine(node) {
  let found = false;
  const visit = (/** @type {ts.Node} */ child) => {
    if (isDefineCall(child)) found = true;
    else ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** The Web Audio node classes a piece of source constructs, for links to their documentation. */
function nativeNodes(code) {
  const found = new Set();
  for (const match of code.matchAll(/\bnew\s+([A-Z]\w*Node)\s*\(/g)) found.add(match[1]);
  return [...found];
}

function nodeSources() {
  /** @type {Record<string, { parts: object[], native: string[] }>} */
  const sources = {};
  const files = readdirSync(new URL('src/nodes/', ROOT))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  for (const name of files) {
    const file = parse(`src/nodes/${name}`);
    /** @type {Map<string, ts.FunctionDeclaration>} */
    const factories = new Map();
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name && containsDefine(statement)) {
        factories.set(statement.name.text, statement);
      }
    }
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const call = declaration.initializer;
        if (!call || !ts.isCallExpression(call)) continue;
        let type = null;
        const parts = [];
        if (isDefineCall(call)) {
          type = literalType(call);
          parts.push(part(file, statement));
        } else if (ts.isIdentifier(call.expression) && factories.has(call.expression.text)) {
          const first = call.arguments[0];
          if (first && ts.isStringLiteralLike(first)) type = first.text;
          parts.push(part(file, statement));
          parts.push(
            part(
              file,
              factories.get(call.expression.text),
              `${call.expression.text}(), which builds it`,
            ),
          );
        }
        if (type === null) continue;
        sources[type] = { parts, native: nativeNodes(parts.map((p) => p.code).join('\n')) };
      }
    }
  }
  return sources;
}

function helperSources() {
  // name -> the export of src/util it points at, read from `fn: util.x` in the documented list.
  const docs = parse('src/util/helper-docs.ts');
  /** @type {Map<string, string>} */
  const exportOf = new Map();
  const visit = (/** @type {ts.Node} */ node) => {
    if (ts.isObjectLiteralExpression(node)) {
      let name = null;
      let target = null;
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = property.name.getText();
        if (key === 'name' && ts.isStringLiteralLike(property.initializer)) {
          name = property.initializer.text;
        }
        if (key === 'fn' && ts.isPropertyAccessExpression(property.initializer)) {
          target = property.initializer.name.text;
        }
      }
      if (name && target) exportOf.set(name, target);
    }
    ts.forEachChild(node, visit);
  };
  visit(docs);

  /** @type {Map<string, { file: ts.SourceFile, node: ts.Node }>} */
  const exported = new Map();
  const files = readdirSync(new URL('src/util/', ROOT))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  for (const name of files) {
    const file = parse(`src/util/${name}`);
    for (const statement of file.statements) {
      const isExported = ts.canHaveModifiers(statement)
        ? (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        : false;
      if (!isExported) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        // Of several overloads, the last is the one with the body.
        exported.set(statement.name.text, { file, node: statement });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            exported.set(declaration.name.text, { file, node: statement });
          }
        }
      }
    }
  }

  /** @type {Record<string, { parts: object[], native: string[] }>} */
  const sources = {};
  for (const [name, target] of exportOf) {
    const found = exported.get(target);
    if (!found) throw new Error(`helper ${name}: no export named ${target} in src/util`);
    sources[name] = { parts: [part(found.file, found.node)], native: [] };
  }
  return sources;
}

function generate() {
  const nodes = nodeSources();
  const helpers = helperSources();
  return `// Generated by scripts/extract-sources.mjs from src/nodes and src/util. Do not edit.
// \`npm run sources\` writes it; \`npm run lint\` fails if it is out of date.
import type { SourceEntry } from './sources';

export const NODE_SOURCES: Readonly<Record<string, SourceEntry>> = ${JSON.stringify(nodes, null, 1)};

export const HELPER_SOURCES: Readonly<Record<string, SourceEntry>> = ${JSON.stringify(helpers, null, 1)};
`;
}

const output = generate();
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(new URL(OUTPUT, ROOT), 'utf8');
  } catch {
    // Missing counts as out of date.
  }
  if (current !== output) {
    console.error(`${OUTPUT} is out of date. Run: npm run sources`);
    process.exit(1);
  }
  console.log(`${OUTPUT} is up to date.`);
} else {
  writeFileSync(new URL(OUTPUT, ROOT), output);
  console.log(`Wrote ${OUTPUT} (${(output.length / 1024).toFixed(0)} kB).`);
}
