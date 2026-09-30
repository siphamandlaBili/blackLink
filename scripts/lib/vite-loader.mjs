// Node module hooks so smoke tests can import the frontend's services as the browser gets
// them: extensionless imports resolve to .js/.jsx, and `import.meta.env` (Vite) reads
// globalThis.__VITE_ENV__. Only files under the frontend's src folder are touched.
// Test-only; the app itself is built by Vite.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let frontendSrc = null;
export function initialize(data) {
  frontendSrc = data?.frontendSrc ?? null;
}
const isFrontend = (url) => Boolean(frontendSrc) && url.startsWith(frontendSrc);

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/\.[cm]?jsx?$|\.json$/.test(specifier) && context.parentURL && isFrontend(context.parentURL)) {
    for (const ext of ['.js', '.jsx', '/index.js']) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  const result = await next(url, context);
  if (isFrontend(url) && /\.jsx?$/.test(url)) {
    const source = String(result.source ?? '');
    return { ...result, format: 'module', source: source.replaceAll('import.meta.env', 'globalThis.__VITE_ENV__') };
  }
  return result;
}
