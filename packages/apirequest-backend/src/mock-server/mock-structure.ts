import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { JSONPath } from 'jsonpath-plus';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

const validators = [
  new Ajv({ strict: false, addUsedSchema: false }),
  new Ajv2019({ strict: false, addUsedSchema: false }),
  new Ajv2020({ strict: false, addUsedSchema: false }),
].map((v) => addFormats(v));
const schemas = new Map<string, ReturnType<Ajv['compile']>>();
function schema(value: string) {
  if (schemas.has(value)) return schemas.get(value)!;
  const parsed = JSON.parse(value);
  const dialect = String(parsed?.$schema ?? '');
  const compiled =
    validators[
      dialect.includes('2020-12') ? 2 : dialect.includes('2019-09') ? 1 : 0
    ].compile(parsed);
  if (schemas.size >= 100) schemas.clear();
  schemas.set(value, compiled);
  return compiled;
}
export const structureOperators = ['json_schema', 'jsonpath', 'xpath'];
export function validateStructure(
  operator: string,
  key: string,
  value: string,
  namespaces: Record<string, string> = {},
) {
  if (operator === 'json_schema') schema(value);
  if (operator === 'jsonpath') JSONPath({ path: key, json: {}, eval: 'safe' });
  if (operator === 'xpath') {
    const node = new DOMParser().parseFromString('<root/>', 'text/xml');
    xpath.useNamespaces(namespaces)(key, node);
  }
}
export function matchStructure(
  operator: string,
  actual: unknown,
  key: string,
  value: string,
  namespaces: Record<string, string> = {},
): boolean {
  try {
    if (operator === 'json_schema') return schema(value)(actual) as boolean;
    let values: unknown[];
    if (operator === 'jsonpath')
      values = JSONPath({
        path: key,
        json: actual as object,
        eval: 'safe',
        wrap: true,
      }) as unknown[];
    else {
      if (
        typeof actual !== 'string' ||
        /<!DOCTYPE|<!ENTITY/i.test(actual) ||
        actual.length > 1048576
      )
        return false;
      const errors: string[] = [];
      const document = new DOMParser({
        errorHandler: {
          warning: () => {},
          error: (m) => errors.push(m),
          fatalError: (m) => errors.push(m),
        },
      }).parseFromString(actual, 'text/xml');
      if (errors.length || !document.documentElement) return false;
      const result = xpath.useNamespaces(namespaces)(key, document);
      values = Array.isArray(result)
        ? result.map((v) =>
            (v as any).nodeType === 2
              ? (v as any).value
              : (v as any).textContent,
          )
        : [result];
      if (value === '' && typeof result === 'boolean') return result;
    }
    if (value === '') return values.length > 0;
    return values.some(
      (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)) === value,
    );
  } catch {
    return false;
  }
}
