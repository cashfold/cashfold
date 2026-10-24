// The lines of a hash manifest (`<sha256>  <file>`, `#` for comments) as [hash, file] pairs. Line endings are LF or CRLF: a Windows checkout
// without .gitattributes turns every line into one that ends in a carriage return, which used to leave the file name empty and every hash "wrong".

/** @param {string} text @returns {Array<[string, string]>} */
export function parseHashManifest(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [hash = '', file = ''] = line.split(/\s+/);
      return [hash, file];
    });
}
