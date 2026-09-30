import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Where the frontend repo is, for the two scripts that read its code. In order:
 * FRONTEND_DIR, the folder above this repo (frontend with the API inside it), or a sibling
 * folder called black-link (the two repos cloned side by side).
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');

export function findFrontend() {
  const candidates = [process.env.FRONTEND_DIR, resolve(repo, '..'), resolve(repo, '..', 'black-link')].filter(Boolean).map((p) => resolve(p));
  const found = candidates.find((dir) => existsSync(join(dir, 'src', 'services', 'apiClient.js')));
  if (!found) throw new Error(`Frontend repo not found (looked in: ${candidates.join(', ')}). Set FRONTEND_DIR to its folder.`);
  return found;
}
