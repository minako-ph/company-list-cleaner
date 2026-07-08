import { z } from 'zod';

/**
 * 境界スキーマの規約（引継書§3.1 schema-buffer / N-3）:
 * - 外部APIレスポンスは必ず passthrough で受け、未知フィールドを保全する
 * - 既知フィールドとの差分（未知フィールド出現・既知フィールド消失）をドリフトとして検知する
 * - ドリフトは CI では fail、実行時は警告ログ＋続行（N-4通知対象）
 */

export interface DriftReport {
  /** データに存在するがスキーマに未定義のキー（ドット区切りパス） */
  unknownFields: string[];
  /** スキーマ上必須なのにデータに存在しないキー（ドット区切りパス） */
  missingFields: string[];
  hasDrift: boolean;
}

export interface BufferedParseResult<T> {
  value: T;
  drift: DriftReport;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault
  ) {
    current = current instanceof z.ZodDefault ? current._def.innerType : current.unwrap();
  }
  return current;
}

function collectDrift(
  schema: z.ZodTypeAny,
  data: unknown,
  path: string,
  report: { unknownFields: string[]; missingFields: string[] },
): void {
  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodArray && Array.isArray(data)) {
    // 配列は先頭要素のみ代表として検査する（全要素検査はコスト過大のため）
    if (data.length > 0) {
      collectDrift(unwrapped.element, data[0], `${path}[]`, report);
    }
    return;
  }

  if (!(unwrapped instanceof z.ZodObject) || !isPlainObject(data)) {
    return;
  }

  const shape: Record<string, z.ZodTypeAny> = unwrapped.shape;
  const shapeKeys = new Set(Object.keys(shape));

  for (const key of Object.keys(data)) {
    if (!shapeKeys.has(key)) {
      report.unknownFields.push(path === '' ? key : `${path}.${key}`);
    }
  }

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const childPath = path === '' ? key : `${path}.${key}`;
    if (!(key in data)) {
      if (!fieldSchema.isOptional()) {
        report.missingFields.push(childPath);
      }
      continue;
    }
    collectDrift(fieldSchema, data[key], childPath, report);
  }
}

/** スキーマと生データを比較し、未知フィールド出現・既知フィールド消失を報告する */
export function detectDrift(schema: z.ZodTypeAny, data: unknown): DriftReport {
  const report: { unknownFields: string[]; missingFields: string[] } = {
    unknownFields: [],
    missingFields: [],
  };
  collectDrift(schema, data, '', report);
  return {
    unknownFields: report.unknownFields,
    missingFields: report.missingFields,
    hasDrift: report.unknownFields.length > 0 || report.missingFields.length > 0,
  };
}

/**
 * 境界スキーマでパースしつつドリフトを検知する。
 * 境界スキーマは明示的に `.passthrough()` を付けて定義すること（未知フィールドを値に保全するため。
 * deepPassthroughは型推論を失うため補助用途）。
 */
export function parseWithBuffer<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): BufferedParseResult<z.infer<S>> {
  const drift = detectDrift(schema, data);
  const value = schema.parse(data);
  return { value, drift };
}

/** ZodObject を再帰的に passthrough 化する（未知フィールド保全の規約を強制） */
export function deepPassthrough(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = schema.shape;
    const newShape: Record<string, z.ZodTypeAny> = {};
    for (const [key, field] of Object.entries(shape)) {
      newShape[key] = deepPassthrough(field);
    }
    return z.object(newShape).passthrough();
  }
  if (schema instanceof z.ZodArray) {
    return z.array(deepPassthrough(schema.element));
  }
  if (schema instanceof z.ZodOptional) {
    return deepPassthrough(schema.unwrap()).optional();
  }
  if (schema instanceof z.ZodNullable) {
    return deepPassthrough(schema.unwrap()).nullable();
  }
  return schema;
}

export { z };
