import { XMLParser } from 'fast-xml-parser';
import { parseWithBuffer } from '@jp-opendata/schema-buffer';
import { houjinXmlEnvelopeSchema, type HoujinParseResult } from './schema.js';

/**
 * 法人番号Web-API Ver.4 のXML(type=12)応答をパースする。
 * - parseTagValue:false: 全タグ値を文字列のまま保持（corporateNumber等の桁溢れ・先頭0欠落を防ぐ）
 * - isArray corporation: 1件でも配列化し、単一/複数/0件の分岐差を吸収（0件時はキー欠落）
 * - trimValues:true: 前後空白を除去（空要素 `<x/>` は "" になる）
 */
const xmlParser = new XMLParser({
  parseTagValue: false,
  trimValues: true,
  ignoreAttributes: true,
  // `<?xml ?>` 宣言をルートの `?xml` キーとして拾わせない（誤ドリフト検知を防ぐ）
  ignoreDeclaration: true,
  isArray: (name: string) => name === 'corporation',
});

export function parseHoujinXml(xml: string): HoujinParseResult {
  const parsed: unknown = xmlParser.parse(xml);
  const { value, drift } = parseWithBuffer(houjinXmlEnvelopeSchema, parsed);
  const env = value.corporations;
  return {
    header: {
      lastUpdateDate: env.lastUpdateDate,
      count: Number(env.count),
      divideNumber: Number(env.divideNumber),
      divideSize: Number(env.divideSize),
    },
    corporations: env.corporation ?? [],
    drift,
  };
}
