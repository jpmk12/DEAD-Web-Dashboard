// Search-query token parser for the Docs sidebar. PURE (client-imported,
// unit-tested).
//
// "clausewitz course:600 type:theorist" →
//   text  "clausewitz"          (goes to the server FULLTEXT search)
//   props { course: "600" }     (client-side property filter)
//   types ["theorist"]          (client-side doc-type filter)
//
// key:value tokens are conservative: key = word chars/dash, value = one
// non-space run (quote the doc if a spaced value is ever needed — v1 keeps
// the grammar simple). Unknown keys filter on properties; the reserved key
// "type" filters on doc type.

export interface ParsedDocQuery {
  text: string;
  props: Record<string, string>;
  types: string[];
}

const TOKEN_RE = /(^|\s)([A-Za-z][\w-]{0,39}):(\S{1,200})/g;

export function parseDocQuery(q: string): ParsedDocQuery {
  const props: Record<string, string> = {};
  const types: string[] = [];
  const text = q
    .replace(TOKEN_RE, (_m, lead: string, key: string, value: string) => {
      const k = key.toLowerCase();
      if (k === "type") types.push(value.toLowerCase());
      else props[k] = value;
      return lead; // keep the leading whitespace so words don't fuse
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text, props, types };
}

// Does a doc's props object satisfy every requested property filter?
// Case-insensitive substring match on the value: era:18 matches "1832".
export function matchesProps(docProps: Record<string, string> | undefined, filters: Record<string, string>): boolean {
  const keys = Object.keys(filters);
  if (keys.length === 0) return true;
  if (!docProps) return false;
  // Doc property keys are matched case-insensitively too.
  const lowered = new Map(Object.entries(docProps).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  return keys.every((k) => {
    const have = lowered.get(k.toLowerCase());
    return have !== undefined && have.includes(filters[k].toLowerCase());
  });
}
