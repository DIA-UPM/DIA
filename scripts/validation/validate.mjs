// Loads every JSON file under data/ and validates it. Used by the build (which refuses to
// build invalid content) and by `npm run validate`.
//
// Checks: JSON syntax, JSON Schema (schemas/*.schema.json), duplicate slugs, slug/file-name
// consistency, URL formats, and that every referenced local image/document exists in public/.
// Every error names the file and the offending field.
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export class ValidationError extends Error {
  constructor(errors) {
    super(`Content validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):\n` + errors.map((e) => `  ✖ ${e}`).join('\n'));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

// data file → schema. Collections (folders) use one schema per item.
const SINGLE = {
  'site.json': 'site', 'navigation.json': 'navigation', 'homepage.json': 'homepage', 'department.json': 'department',
  'research.json': 'research', 'contact.json': 'contact', 'taxonomies.json': 'taxonomies', 'news-page.json': 'archive-page',
  'personnel-page.json': 'archive-page', 'english.json': null, 'redirects.json': 'redirects',
};
const COLLECTIONS = { news: 'news', personnel: 'person' };
const camel = (s) => s.replace(/\.json$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function readJson(file, rel, errors) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { errors.push(`${rel}: cannot read file (${e.message})`); return undefined; }
  try { return JSON.parse(text); } catch (e) {
    const pos = Number((/position (\d+)/.exec(e.message) || [])[1]);
    const line = Number.isFinite(pos) ? text.slice(0, pos).split('\n').length : '?';
    errors.push(`${rel}: malformed JSON near line ${line} — ${e.message}`);
    return undefined;
  }
}

export function loadAndValidate(root, { throwOnError = true, publicDir = path.join(root, 'public') } = {}) {
  const dataDir = path.join(root, 'data');
  const errors = [];
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  const schemas = {};
  for (const f of fs.readdirSync(path.join(root, 'schemas'))) {
    if (!f.endsWith('.schema.json')) continue;
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', f), 'utf8'));
    schemas[f.replace('.schema.json', '')] = ajv.compile(schema);
  }
  const check = (name, value, rel) => {
    const validate = schemas[name];
    if (!validate || validate(value)) return;
    for (const e of validate.errors) {
      const field = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : '(root)';
      if (e.keyword === 'required') errors.push(`${rel}: required field "${field === '(root)' ? '' : field + '.'}${e.params.missingProperty}" is missing`);
      else if (e.keyword === 'additionalProperties') errors.push(`${rel}: field "${field === '(root)' ? '' : field + '.'}${e.params.additionalProperty}" is not allowed (typo?)`);
      else errors.push(`${rel}: field "${field}" ${e.message}`);
    }
  };

  const data = {};
  for (const f of fs.readdirSync(dataDir)) {
    const full = path.join(dataDir, f);
    if (fs.statSync(full).isDirectory()) continue;
    if (!f.endsWith('.json')) continue;
    const rel = `data/${f}`;
    const value = readJson(full, rel, errors);
    if (value === undefined) continue;
    if (!(f in SINGLE)) errors.push(`${rel}: unknown data file (expected one of: ${Object.keys(SINGLE).join(', ')})`);
    else if (SINGLE[f]) check(SINGLE[f], value, rel);
    data[camel(f)] = value;
  }
  for (const f of Object.keys(SINGLE)) if (SINGLE[f] && !fs.existsSync(path.join(dataDir, f))) errors.push(`data/${f}: required file is missing`);

  for (const [dir, schema] of Object.entries(COLLECTIONS)) {
    data[dir] = {};
    const folder = path.join(dataDir, dir);
    if (!fs.existsSync(folder)) { errors.push(`data/${dir}/: folder is missing`); continue; }
    for (const f of fs.readdirSync(folder).sort()) {
      if (!f.endsWith('.json')) continue;
      const rel = `data/${dir}/${f}`;
      const value = readJson(path.join(folder, f), rel, errors);
      if (value === undefined) continue;
      check(schema, value, rel);
      if (value.slug && value.slug !== f.replace(/\.json$/, '')) errors.push(`${rel}: field "slug" is "${value.slug}" but the file is named "${f}" (they must match)`);
      if (value.slug && data[dir][value.slug]) errors.push(`${rel}: duplicate slug "${value.slug}"`);
      if (value.slug) data[dir][value.slug] = { ...value, __file: rel };
    }
  }

  // Slugs must be unique across news, personnel and top-level pages (they share the URL space).
  const reserved = new Set(['noticias', 'contacto', 'investigacion_dia', 'el-departamento-de-inteligencia-artificial-presentacion', 'personaldia', 'tag', 'category', 'author', 'en', 'buscar', 'assets']);
  for (const slug of Object.keys(data.news || {})) if (reserved.has(slug)) errors.push(`${data.news[slug].__file}: field "slug" "${slug}" collides with an existing page URL`);

  // Every local asset referenced anywhere in the data must exist in public/.
  const walkRefs = (value, rel, where) => {
    if (typeof value === 'string') {
      for (const m of value.matchAll(/\/assets\/[^"'\s)<>,]+/g)) {
        const p = decodeURIComponent(m[0].replace(/&amp;/g, '&'));
        if (!fs.existsSync(path.join(publicDir, p))) errors.push(`${rel}: field "${where}" references ${p}, which does not exist in public/`);
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => walkRefs(v, rel, `${where}[${i}]`));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (k !== '__file') walkRefs(v, rel, where ? `${where}.${k}` : k);
  };
  for (const [k, v] of Object.entries(data)) {
    if (k === 'news' || k === 'personnel') for (const item of Object.values(v)) walkRefs(item, item.__file, '');
    else walkRefs(v, `data/${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}.json`, '');
  }

  // Cross references
  const tagSlugs = new Set((data.taxonomies?.tags || []).map((t) => t.slug));
  const catSlugs = new Set((data.taxonomies?.categories || []).map((t) => t.slug));
  for (const n of Object.values(data.news || {})) {
    for (const t of n.tags || []) if (!tagSlugs.has(t)) errors.push(`${n.__file}: field "tags" contains "${t}", which is not defined in data/taxonomies.json`);
    for (const c of n.categories || []) if (!catSlugs.has(c)) errors.push(`${n.__file}: field "categories" contains "${c}", which is not defined in data/taxonomies.json`);
  }
  for (const p of Object.values(data.personnel || {})) {
    for (const t of [p.category, ...(p.categories || [])].filter(Boolean)) if (!tagSlugs.has(t)) errors.push(`${p.__file}: field "category" "${t}" is not a tag defined in data/taxonomies.json`);
  }
  for (const a of data.taxonomies?.authors || []) for (const s of a.posts || []) if (!data.news?.[s]) errors.push(`data/taxonomies.json: author "${a.slug}" lists post "${s}", which does not exist in data/news/`);
  if (data.department) {
    for (const [i, m] of (data.department.management?.members || []).entries()) if (!data.personnel?.[m.person]) errors.push(`data/department.json: field "management.members[${i}].person" references "${m.person}", which does not exist in data/personnel/`);
  }

  if (errors.length && throwOnError) throw new ValidationError(errors);
  return throwOnError ? data : { data, errors };
}
