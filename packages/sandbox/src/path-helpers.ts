import path from 'node:path';

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}
