// A pseudo-locale for tests (FR-046): `en-XA` turns every English message into an accented string about 40 percent longer, wrapped in
// markers, so clipped or overflowing text shows up in the responsive tests. It keeps ICU placeholders, plural/select syntax, number formats
// and quoted text intact. It is never offered to people and only chosen when the browser asks for exactly `en-XA`.
export const PSEUDO_LOCALE = 'en-XA';

const ACCENTS: Readonly<Record<string, string>> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

/** Accents the letters and lengthens every word by about 40 percent (so lines wrap where a longer language would, and no word is unbreakably long). */
function textRun(text: string): string {
  if (text.trim() === '') return text;
  return text.replace(/[A-Za-z]+/g, (word) => [...word].map((c) => ACCENTS[c] ?? c).join('') + 'ẋ'.repeat(Math.ceil(word.length * 0.4)));
}

/** Reads the body of a `{…}` group starting after the opening brace; returns the body and the index after the closing brace. */
function group(source: string, start: number): { body: string; end: number } {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const c = source[i]!;
    if (c === "'" && source[i + 1] === '{') {
      const close = source.indexOf("'", i + 1);
      i = close === -1 ? source.length : close + 1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return { body: source.slice(start, i - 1), end: i };
}

function transform(source: string): string {
  let out = '';
  let text = '';
  const flush = () => {
    out += textRun(text);
    text = '';
  };
  for (let i = 0; i < source.length; ) {
    const c = source[i]!;
    if (c === "'") {
      // ICU quoting: '' is an apostrophe, '{…}' is literal text. Both stay as they are.
      if (source[i + 1] === "'") {
        flush();
        out += "''";
        i += 2;
      } else if (source[i + 1] === '{' || source[i + 1] === '}') {
        flush();
        const close = source.indexOf("'", i + 1);
        const end = close === -1 ? source.length : close + 1;
        out += source.slice(i, end);
        i = end;
      } else {
        text += c;
        i++;
      }
    } else if (c === '{') {
      flush();
      const { body, end } = group(source, i + 1);
      const parts = body.split(',');
      const kind = parts[1]?.trim();
      if (kind === 'plural' || kind === 'select' || kind === 'selectordinal') {
        const head = parts.slice(0, 2).join(',') + ',';
        const rest = body.slice(head.length);
        // After the type: [offset:n] then `selector {branch}` pairs.
        let branches = '';
        for (let j = 0; j < rest.length; ) {
          const open = rest.indexOf('{', j);
          if (open === -1) {
            branches += rest.slice(j);
            break;
          }
          const inner = group(rest, open + 1);
          branches += `${rest.slice(j, open + 1)}${transform(inner.body)}}`;
          j = inner.end;
        }
        out += `{${head}${branches}}`;
      } else {
        out += `{${body}}`;
      }
      i = end;
    } else {
      text += c;
      i++;
    }
  }
  flush();
  return out;
}

export function pseudoLocalize(message: string): string {
  return `[${transform(message)}]`;
}

export function pseudoCatalogue(english: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(english).map(([key, message]) => [key, pseudoLocalize(message)]));
}
