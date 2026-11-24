// A small JSON Schema checker for the plain subset docs/formats/*.schema.json use (type, const,
// enum, required, properties, additionalProperties, items, minItems, maxItems, minimum,
// minLength, oneOf, local $ref). Kept here so the project needs no validator dependency.
// Returns a list of "path: problem" strings; empty means valid.
export function checkSchema(root, value) {
  const errors = [];
  const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const isType = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number');
  const walk = (s, v, path, out) => {
    if (s === true || s === undefined) return;
    if (s.$ref) return walk(resolve(s.$ref), v, path, out);
    if (s.oneOf) {
      const ok = s.oneOf.filter((alt) => { const e = []; walk(alt, v, path, e); return !e.length; });
      if (ok.length !== 1) out.push(`${path}: matches ${ok.length} of the oneOf choices`);
      return;
    }
    if ('const' in s && v !== s.const) out.push(`${path}: must be ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) out.push(`${path}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`);
    if (s.type && ![].concat(s.type).some((t) => isType(v, t))) { out.push(`${path}: must be ${s.type}, is ${typeOf(v)}`); return; }
    if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) out.push(`${path}: below ${s.minimum}`);
    if (typeof v === 'string' && s.minLength !== undefined && v.length < s.minLength) out.push(`${path}: too short`);
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path}: fewer than ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${path}: more than ${s.maxItems} items`);
      if (s.items) v.forEach((x, i) => walk(s.items, x, `${path}[${i}]`, out));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of s.required || []) if (!(k in v)) out.push(`${path}: missing "${k}"`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties && k in s.properties) walk(s.properties[k], x, `${path}.${k}`, out);
        else if (s.additionalProperties === false) out.push(`${path}: "${k}" is not described in the schema`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${path}.${k}`, out);
      }
    }
  };
  walk(root, value, '$', errors);
  return errors;
}
