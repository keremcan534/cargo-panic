/**
 * Static import graph of the TypeScript sources, for architecture checks.
 *
 * Only runtime edges count: `import type` / `export type` are erased by the
 * compiler and dynamic `import()` is a deliberate lazy boundary, so neither is
 * followed. That is exactly the question the checks ask - "does loading this
 * module make the browser load three.js?" - not "does it mention three".
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

export interface GraphNode {
  file: string;
  /** Resolved project files this module imports at runtime. */
  local: string[];
  /** Bare package specifiers (e.g. `three`, `three/addons/...`). */
  packages: string[];
}

const STATIC_IMPORT =
  /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const cand of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

export function parseImports(file: string): GraphNode {
  const src = stripComments(readFileSync(file, 'utf8'));
  const local: string[] = [];
  const packages: string[] = [];
  STATIC_IMPORT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATIC_IMPORT.exec(src))) {
    const [, , typeOnly, spec] = m;
    if (typeOnly) continue;
    // `export { x }` without `from` has no specifier and never matches.
    if (spec.endsWith('.css')) continue;
    if (spec.startsWith('.')) {
      const hit = resolveLocal(file, spec);
      if (hit) local.push(hit);
    } else {
      packages.push(spec);
    }
  }
  return { file, local, packages };
}

/** Every module reachable from `entry` through runtime static imports. */
export function reachable(entry: string): Map<string, GraphNode> {
  const seen = new Map<string, GraphNode>();
  const stack = [resolve(entry)];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    const node = parseImports(f);
    seen.set(f, node);
    for (const l of node.local) if (!seen.has(l)) stack.push(l);
  }
  return seen;
}

/** Shortest runtime import chain from `entry` to any module importing `pkg`. */
export function chainTo(entry: string, pkg: (spec: string) => boolean, root = process.cwd()): string[] | null {
  const start = resolve(entry);
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const f = queue.shift()!;
    const node = parseImports(f);
    const hit = node.packages.find(pkg);
    if (hit) {
      const path: string[] = [hit];
      let cur: string | null = f;
      while (cur) {
        path.unshift(relative(root, cur));
        cur = prev.get(cur) ?? null;
      }
      return path;
    }
    for (const l of node.local) {
      if (!prev.has(l)) {
        prev.set(l, f);
        queue.push(l);
      }
    }
  }
  return null;
}

export const isThree = (spec: string) => spec === 'three' || spec.startsWith('three/');
