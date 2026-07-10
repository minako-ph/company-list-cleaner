import { ministryToEnglish, toHalfWidth } from '@jp-opendata/normalize-jp';

/**
 * gBizINFO 法人検索APIの`ministry`パラメータに使う担当府省の内部コード
 * （setcodelist.pdf Ver.1.01 2024-4-19。原本は404のためWayback Machine採取、
 * docs/research/gbizinfo-subsidy.md）。コードはgBizINFO固有の内部値。
 */
export const GBIZ_MINISTRY_CODES: ReadonlyArray<{ code: string; ja: string }> = [
  { code: '1', ja: '国税庁' },
  { code: '2', ja: '会計検査院' },
  { code: '3', ja: '内閣官房' },
  { code: '4', ja: '人事院' },
  { code: '5', ja: '内閣府' },
  { code: '6', ja: '宮内庁' },
  { code: '7', ja: '国家公安委員会' },
  { code: '8', ja: '防衛省' },
  { code: '9', ja: '金融庁' },
  { code: '10', ja: '総務省' },
  { code: '11', ja: '法務省' },
  { code: '12', ja: '外務省' },
  { code: '13', ja: '財務省' },
  { code: '14', ja: '文部科学省' },
  { code: '15', ja: '厚生労働省' },
  { code: '16', ja: '農林水産省' },
  { code: '17', ja: '経済産業省' },
  { code: '18', ja: '国土交通省' },
  { code: '19', ja: '環境省' },
  { code: '20', ja: '消費者庁' },
  { code: '21', ja: '復興庁' },
  { code: '22', ja: '公正取引委員会' },
  { code: '23', ja: '個人情報保護委員会' },
  { code: '24', ja: '特許庁' },
  { code: '25', ja: '消防庁' },
  { code: '26', ja: '資源エネルギー庁' },
  { code: '27', ja: '中小企業庁' },
  { code: '28', ja: '情報処理推進機構' },
  { code: '29', ja: '製品評価技術基盤機構' },
  { code: '30', ja: '国立研究開発法人新エネルギー・産業技術総合開発機構' },
  { code: '31', ja: '工業所有権情報・研修館' },
  { code: '32', ja: '中小企業基盤整備機構' },
  { code: '33', ja: '石油天然ガス・金属鉱物資源機構' },
  { code: '34', ja: '日本貿易振興機構' },
  { code: '35', ja: '観光庁' },
  { code: '36', ja: '気象庁' },
  { code: '37', ja: '原子力規制委員会' },
  { code: '38', ja: '内閣法制局' },
  { code: '39', ja: '水産庁' },
  { code: '40', ja: '独立行政法人郵便貯金簡易生命保険管理・郵便局ネットワーク支援機構' },
  { code: '41', ja: '公益財団法人食品等流通合理化促進機構' },
  { code: '42', ja: '海上保安庁' },
  { code: '43', ja: 'スポーツ庁' },
  { code: '44', ja: '警察庁' },
  { code: '45', ja: 'デジタル庁' },
  { code: '46', ja: '林野庁' },
  { code: '47', ja: '文化庁' },
  { code: '48', ja: '公害等調整委員会' },
  { code: '49', ja: 'こども家庭庁' },
];

export interface ResolvedMinistry {
  code: string;
  ja: string;
  en: string | null;
}

/**
 * ministry入力（内部コード・日本語名・英語公式名のいずれか）を内部コードへ解決する。
 * 解決できない場合はnull（呼び出し側で候補提示のエラーにする）。
 */
export function resolveMinistry(input: string): ResolvedMinistry | null {
  const trimmed = toHalfWidth(input.trim()).replace(/ +/g, ' ');
  if (trimmed === '') return null;
  if (/^\d{1,2}$/.test(trimmed)) {
    const hit = GBIZ_MINISTRY_CODES.find((m) => m.code === String(Number(trimmed)));
    return hit ? { ...hit, en: ministryToEnglish(hit.ja) } : null;
  }
  const compact = trimmed.replace(/ /g, '');
  const byJa = GBIZ_MINISTRY_CODES.find((m) => m.ja === compact);
  if (byJa) return { ...byJa, en: ministryToEnglish(byJa.ja) };
  const lower = trimmed.toLowerCase();
  const byEn = GBIZ_MINISTRY_CODES.find((m) => ministryToEnglish(m.ja)?.toLowerCase() === lower);
  return byEn ? { ...byEn, en: ministryToEnglish(byEn.ja) } : null;
}
