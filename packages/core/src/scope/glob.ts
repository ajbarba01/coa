/**
 * The minimal glob matcher backing the SCO-1 `glob` leaf — the neutral floor that
 * always resolves and needs no parser. Supports `**` (any path segments), `*`
 * (any chars within a segment), and `?` (one non-separator char). Anchored full
 * match. A small in-house matcher keeps the dependency surface tight; richer glob
 * features are additive.
 */
const SPECIAL = /[.+^${}()|[\]\\]/g;

export function matchGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++; // consume the second star
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if (char !== undefined) {
      out += char.replace(SPECIAL, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}
