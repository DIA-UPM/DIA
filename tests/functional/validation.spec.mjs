// Phase 11 – the build refuses invalid content with messages that name the file and field.
// Each case works on a temporary COPY of data/ (the real files are never modified).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadAndValidate } from '../../scripts/validation/validate.mjs';
import { ROOT } from './helpers.mjs';

function withTempData(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dia-validate-'));
  try {
    fs.cpSync(path.join(ROOT, 'data'), path.join(tmp, 'data'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'schemas'), path.join(tmp, 'schemas'), { recursive: true });
    mutate(path.join(tmp, 'data'));
    return loadAndValidate(tmp, { throwOnError: false, publicDir: path.join(ROOT, 'public') }).errors;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const edit = (file, fn) => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); fn(j); fs.writeFileSync(file, JSON.stringify(j, null, 2)); };

test.describe('JSON validation', () => {
  test('the real content is valid', () => {
    expect(loadAndValidate(ROOT, { throwOnError: false }).errors).toEqual([]);
  });

  test('malformed JSON names the file and line', () => {
    const errors = withTempData((d) => fs.writeFileSync(path.join(d, 'personnel/asun.json'), '{ "slug": "asun", \n  "name": "x",, }'));
    expect(errors.join('\n')).toMatch(/data\/personnel\/asun\.json: malformed JSON near line 2/);
  });

  test('missing required field', () => {
    const errors = withTempData((d) => edit(path.join(d, 'personnel/asun.json'), (j) => { delete j.name; }));
    expect(errors.join('\n')).toContain('data/personnel/asun.json: required field "name" is missing');
  });

  test('duplicate slug / personnel id', () => {
    const errors = withTempData((d) => {
      const j = JSON.parse(fs.readFileSync(path.join(d, 'personnel/asun.json'), 'utf8'));
      fs.writeFileSync(path.join(d, 'personnel/asun-copia.json'), JSON.stringify(j));
    });
    expect(errors.join('\n')).toMatch(/asun-copia\.json: field "slug" is "asun" but the file is named/);
    expect(errors.join('\n')).toMatch(/data\/personnel\/asun(-copia)?\.json: duplicate slug "asun"/);
  });

  test('invalid URL', () => {
    const errors = withTempData((d) => edit(path.join(d, 'navigation.json'), (j) => { j.main[1].children[0].url = 'presentacion sin barra'; }));
    expect(errors.join('\n')).toMatch(/data\/navigation\.json: field "main\.1\.children\.0\.url" must match pattern/);
  });

  test('nonexistent referenced image', () => {
    const errors = withTempData((d) => edit(path.join(d, 'personnel/asun.json'), (j) => { j.image = '/assets/uploads/no-existe.jpg'; }));
    expect(errors.join('\n')).toContain('data/personnel/asun.json: field "image" references /assets/uploads/no-existe.jpg, which does not exist in public/');
  });

  test('unknown category / cross-reference', () => {
    const errors = withTempData((d) => edit(path.join(d, 'personnel/asun.json'), (j) => { j.category = 'no-existe'; }));
    expect(errors.join('\n')).toContain('data/personnel/asun.json: field "category" "no-existe" is not a tag defined in data/taxonomies.json');
  });

  test('invalid email', () => {
    const errors = withTempData((d) => edit(path.join(d, 'personnel/asun.json'), (j) => { j.email = 'asun-arroba-fi'; }));
    expect(errors.join('\n')).toMatch(/data\/personnel\/asun\.json: field "email" must match pattern/);
  });
});
