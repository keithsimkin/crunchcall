import { expect, test } from 'bun:test'
import { createCodes, renderCsv, renderJson, renderSql } from './appsumo-generate-codes.mjs'

const CODE = /^ANN-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

test('generated codes are unique Crockford ids with a csv header and a seed insert', () => {
  const codes = createCodes(32)
  expect(new Set(codes).size).toBe(32)
  expect(codes.every((code) => CODE.test(code))).toBe(true)
  const csv = renderCsv(codes)
  expect(csv.startsWith('code\n')).toBe(true)
  expect(csv.trim().split('\n')).toHaveLength(33)
  const sql = renderSql(codes, 'appsumo-test')
  expect(sql).toContain('insert into public.appsumo_codes (code, batch)')
  expect(sql).toContain("('ANN-")
  expect(sql.trimEnd().endsWith('on conflict (code) do nothing;')).toBe(true)
  expect(JSON.parse(renderJson(codes, 'appsumo-test')).codes).toEqual(codes)
})
