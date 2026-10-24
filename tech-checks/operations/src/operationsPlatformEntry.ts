/** Resolve only the packaged, same-origin parent login page. Never carry
 * bearer material, arbitrary query parameters or an external return URL. */
export function operationsPlatformEntry(pathname: string): string | null {
  const match = pathname.match(/^(.*\/)operations\/dist\/(?:index\.html)?$/);
  if (!match || !match[1].startsWith('/') || match[1].startsWith('//') || /[\\?#]/.test(match[1])) return null;
  return match[1] + 'index.html';
}
