// Incident type catalogue. Rates are relative weights per time band [day 6-17, evening 17-22, night 22-6].
import type { UnitKind } from './types';

export type Where = 'signal' | 'major' | 'motorway' | 'hotspot' | 'night' | 'shop' | 'station' | 'residential' | 'tourist' | 'park' | 'any';

export interface Development {
  p: number; // probability per incident (rolled once at a random time while on scene)
  text: string; // report from the field
  priority?: number; // new priority
  minUnits?: number;
  work?: number; // additional unit-minutes
  escalateTo?: string;
  injury?: boolean;
}

export interface IncidentType {
  key: string;
  name: string;
  code: string; // 2-char map badge
  priority: 1 | 2 | 3 | 4;
  minUnits: number;
  idealUnits: number;
  work: number; // unit-minutes on scene to complete
  rate: [number, number, number];
  where: Where[];
  bonus?: UnitKind[]; // unit kinds especially effective
  flee?: { p: number; mode: 'foot' | 'bike' | 'car' | 'moto'; afterMin: number };
  escalate?: { afterMin: number; p: number; to?: string; text: string };
  transport?: number; // probability somebody is taken to the station
  callers: string[];
  details: string[];
  suspects?: string[];
  outcomes: string[];
  failOutcome?: string;
  developments?: Development[];
}

const SUSPECT_DESC = [
  '20代くらいの男、黒色パーカー、ジーパン',
  '30代くらいの男、グレーの上下ジャージ、マスク着用',
  '40代くらいの男、紺色ジャンパー、黒色キャップ',
  '若い男、白色Tシャツ、金髪',
  '50代くらいの男、作業服、小太り',
  '10代後半の男2人組、黒っぽい服装',
  '20代くらいの男、カーキ色ブルゾン、リュックサック所持',
  '身長170センチくらいの男、黒色ダウン、白色スニーカー',
  '30代くらいの女、ベージュのコート、茶髪',
];

export const INCIDENT_TYPES: IncidentType[] = [
  {
    key: 'acc_prop', name: '交通事故（物損）', code: '物損', priority: 3, minUnits: 1, idealUnits: 1, work: 25,
    rate: [11, 9, 3], where: ['signal', 'major'], bonus: ['kotsu'],
    callers: ['当事者（男性）', '当事者（女性）', '目撃者', 'タクシー運転手'],
    details: ['乗用車同士の接触事故、けが人なし', '右折車と直進車の衝突、けが人なしの模様', '駐車車両への追突、相手方不明', '車とバイクの接触、双方けがなしと申告'],
    outcomes: ['物件事故として処理、当事者間で示談', '物件事故として処理、レッカー手配済み', '双方立会いで実況見分終了'],
    developments: [
      { p: 0.15, text: '当事者の一方が首の痛みを訴えている、人身事故の可能性', priority: 2, work: 25, injury: true },
      { p: 0.1, text: '事故車両が車線を塞いでおり渋滞発生中、交通整理を要する', minUnits: 2, work: 15 },
    ],
  },
  {
    key: 'acc_inj', name: '交通事故（人身）', code: '人身', priority: 2, minUnits: 2, idealUnits: 3, work: 70,
    rate: [5, 5, 2], where: ['signal', 'major'], bonus: ['kotsu'],
    callers: ['目撃者', '当事者（男性）', '通行人', '近くの店員'],
    details: ['歩行者と乗用車の事故、歩行者が転倒し動けない模様', '自転車と軽トラックの衝突、自転車の男性が頭部から出血', '原付と乗用車の出会い頭事故、原付運転者負傷', '乗用車3台が絡む追突事故、1名負傷'],
    outcomes: ['負傷者救急搬送、実況見分終了、交通規制解除', '救急搬送済み、運転者から事情聴取し署へ同行', '実況見分終了、事故車両撤去完了'],
    transport: 0.3,
    escalate: { afterMin: 8, p: 0.4, text: '再入電、事故現場付近で渋滞が拡大、二次事故の危険あり' },
    developments: [
      { p: 0.2, text: '負傷者の意識レベル低下、救急隊到着まで交通規制を継続する', work: 20 },
      { p: 0.15, text: '加害車両の運転手から酒の臭い、飲酒検知を実施する', work: 30, priority: 2 },
    ],
  },
  {
    key: 'acc_major', name: '多重衝突事故', code: '重事', priority: 1, minUnits: 3, idealUnits: 5, work: 150,
    rate: [0.6, 0.6, 0.4], where: ['motorway', 'major'], bonus: ['kotsu'],
    callers: ['目撃者', '阪神高速道路（株）', '当事者'],
    details: ['大型トラックを含む車両4台の多重衝突、負傷者複数', '乗用車が横転、後続車が次々に追突', 'ワゴン車と大型車の衝突、車内に閉じ込められた者あり'],
    outcomes: ['負傷者全員搬送、通行止め解除', '実況見分終了、事故車両撤去、規制解除'],
    developments: [{ p: 0.4, text: '車両から燃料漏れ、消防と連携し規制範囲を拡大する', minUnits: 4, work: 40 }],
  },
  {
    key: 'hitrun', name: 'ひき逃げ事件', code: '轢逃', priority: 1, minUnits: 2, idealUnits: 4, work: 90,
    rate: [0.6, 0.7, 0.6], where: ['major', 'residential'], bonus: ['kisou', 'kotsu'],
    flee: { p: 1, mode: 'car', afterMin: 0 },
    callers: ['目撃者', '通行人', 'マル害本人'],
    details: ['歩行者をはねた白色ワゴン車がそのまま逃走', '自転車と接触した黒色セダンが停止せず逃走', 'バイクと接触した軽自動車が逃走、ナンバー一部判明'],
    suspects: ['白色ワゴン車、なにわナンバー', '黒色セダン、ナンバー末尾「12」', '銀色の軽自動車、大阪ナンバー', '紺色ミニバン、和泉ナンバー'],
    outcomes: ['逃走車両を発見、運転者を確保', '被害者搬送、実況見分終了、捜査継続'],
    failOutcome: '逃走車両発見に至らず、手配継続',
  },
  {
    key: 'snatch', name: 'ひったくり事件', code: '引手', priority: 2, minUnits: 2, idealUnits: 4, work: 50,
    rate: [1.5, 2.5, 2], where: ['residential', 'hotspot'], bonus: ['kisou'],
    flee: { p: 1, mode: 'bike', afterMin: 0 },
    callers: ['マル害本人（女性）', '目撃者', '通行人'],
    details: ['自転車の前かごからバッグをひったくられた', '歩行中の高齢女性がバイクの男にバッグを奪われた', '背後から来た自転車の男にショルダーバッグを奪われ転倒'],
    suspects: SUSPECT_DESC,
    outcomes: ['マル被確保、被害品回収', 'マル被を確保、署へ連行'],
    failOutcome: 'マル被は逃走、被害届受理、緊急配備解除',
    transport: 0.9,
  },
  {
    key: 'robbery', name: 'コンビニ強盗事件', code: '強盗', priority: 1, minUnits: 3, idealUnits: 5, work: 120,
    rate: [0.25, 0.5, 1], where: ['shop', 'residential'], bonus: ['kisou'],
    flee: { p: 0.85, mode: 'foot', afterMin: 0 },
    callers: ['店員（男性）', '店長', '客'],
    details: ['刃物を持った男がレジの現金を奪って逃走', '男が店員に刃物を突きつけ、現金を要求', '覆面の男がレジから現金約5万円を奪い逃走'],
    suspects: SUSPECT_DESC,
    outcomes: ['マル被確保、凶器押収', 'マル被確保、強盗容疑で通常逮捕'],
    failOutcome: 'マル被逃走、緊急配備継続のまま捜査本部へ引継ぎ',
    transport: 1,
  },
  {
    key: 'assault', name: '暴行・傷害事件', code: '暴行', priority: 1, minUnits: 2, idealUnits: 3, work: 70,
    rate: [1, 2.5, 4], where: ['night', 'hotspot'], bonus: [],
    flee: { p: 0.35, mode: 'foot', afterMin: 4 },
    callers: ['目撃者', '店員', 'マル害の連れ', '通行人'],
    details: ['路上で男性が殴られて倒れている', '店内で客同士が殴り合い、1名出血', '男が通行人に因縁をつけて殴りかかった'],
    suspects: SUSPECT_DESC,
    outcomes: ['マル被確保、傷害容疑で現行犯逮捕', 'マル被を任意同行、マル害は救急搬送'],
    failOutcome: 'マル被逃走、被害届受理',
    transport: 0.8,
    developments: [{ p: 0.25, text: 'マル被が興奮状態で暴れている、応援求む', minUnits: 3, work: 20 }],
  },
  {
    key: 'fight', name: '喧嘩口論', code: '口論', priority: 3, minUnits: 2, idealUnits: 2, work: 30,
    rate: [1.5, 4, 6], where: ['night', 'hotspot'], bonus: [],
    callers: ['店員', '通行人', '近隣住民', 'タクシー運転手'],
    details: ['酔客同士が路上で口論、つかみ合いになりそう', '飲食店前で男性数名が言い争い', 'タクシー乗り場で順番をめぐり口論'],
    escalate: { afterMin: 7, p: 0.4, to: 'assault', text: '再入電、口論していた男らが殴り合いを始めた' },
    outcomes: ['双方に指導警告、解散させた', '当事者を分離し事情聴取、事件性なし'],
    developments: [{ p: 0.15, text: '一方が手を出した模様、暴行事件として対応する', escalateTo: 'assault' }],
  },
  {
    key: 'drunk', name: '泥酔者保護', code: '泥酔', priority: 3, minUnits: 1, idealUnits: 2, work: 35,
    rate: [0.5, 3, 6], where: ['night', 'station', 'hotspot'],
    callers: ['駅員', '店員', '通行人', 'タクシー運転手'],
    details: ['路上で男性が寝込んでいる、呼びかけに反応薄い', '泥酔した男性が車道にはみ出している', '泥酔客が店から出ていかない'],
    outcomes: ['泥酔者を保護、家族に引渡し', '泥酔者を保護し署で保護室へ', '意識清明となり自力で帰宅'],
    transport: 0.55,
  },
  {
    key: 'suspicious', name: '不審者', code: '不審', priority: 3, minUnits: 1, idealUnits: 2, work: 20,
    rate: [3, 3, 3], where: ['residential', 'park', 'any'],
    flee: { p: 0.25, mode: 'foot', afterMin: 6 },
    callers: ['近隣住民', '管理人', '通行人（女性）'],
    details: ['マンション敷地内を不審な男がうろついている', '公園で子どもに声をかけている男がいる', '民家をのぞき込んでいる男がいる', '駐輪場で自転車を物色している男'],
    suspects: SUSPECT_DESC,
    outcomes: ['該当者に職務質問、不審点なし', '該当者発見に至らず、付近警戒を強化', '職務質問の結果、軽犯罪法違反で指導'],
    failOutcome: '該当者は立ち去り、付近警戒',
  },
  {
    key: 'shoplift', name: '万引き（店舗確保）', code: '万引', priority: 3, minUnits: 1, idealUnits: 1, work: 50,
    rate: [5, 3, 0.5], where: ['shop'],
    callers: ['保安員', '店長', '店員'],
    details: ['保安員が万引き犯を事務所で確保中', '化粧品を万引きした女性を店員が確保', '食料品を万引きした高齢男性を確保中'],
    outcomes: ['被疑者を署へ同行、窃盗事件として処理', '被害品買取、微罪処分'],
    transport: 0.7,
  },
  {
    key: 'burglary', name: '侵入盗（空き巣）', code: '侵盗', priority: 2, minUnits: 2, idealUnits: 2, work: 80,
    rate: [2, 1, 0.5], where: ['residential'], bonus: ['kisou'],
    callers: ['住人（女性）', '住人（男性）', '管理会社'],
    details: ['帰宅したら窓ガラスが割られ室内が荒らされていた', '玄関の鍵が壊され貴金属がなくなっている', '事務所の窓がこじ開けられ金庫が荒らされている'],
    outcomes: ['鑑識活動終了、被害届受理', '現場保存、機捜引継ぎ'],
  },
  {
    key: 'dv', name: '家庭内トラブル（DV）', code: 'ＤＶ', priority: 2, minUnits: 2, idealUnits: 3, work: 60,
    rate: [1, 2, 2], where: ['residential'],
    callers: ['近隣住民', '本人（女性）', '子ども'],
    details: ['隣室から怒鳴り声と物が割れる音', '夫に殴られたと女性から通報', '男が部屋で暴れていると子どもから通報'],
    escalate: { afterMin: 9, p: 0.25, to: 'knife', text: '再入電、男が包丁を持ち出している模様' },
    outcomes: ['当事者を分離、生活安全課へ引継ぎ', '夫を暴行容疑で現行犯逮捕', '双方から事情聴取、女性を一時保護'],
    transport: 0.45,
    developments: [{ p: 0.15, text: '男が刃物を手にしている、応援求む', escalateTo: 'knife' }],
  },
  {
    key: 'knife', name: '刃物所持・人質立てこもり', code: '刃物', priority: 1, minUnits: 3, idealUnits: 5, work: 120,
    rate: [0.15, 0.25, 0.35], where: ['residential', 'hotspot', 'shop'], bonus: ['kisou'],
    callers: ['店員', '目撃者', '家族'],
    details: ['男が包丁を振り回しながら叫んでいる', '刃物を持った男が店内に居座っている', '刃物を持った男が路上を徘徊'],
    outcomes: ['マル被を確保、銃刀法違反で現行犯逮捕、負傷者なし', '説得に応じ刃物を放棄、確保'],
    transport: 1,
    developments: [{ p: 0.3, text: 'マル被は説得に応じない、さらに応援求む', minUnits: 5, work: 40 }],
  },
  {
    key: 'noise', name: '騒音苦情', code: '騒音', priority: 4, minUnits: 1, idealUnits: 1, work: 15,
    rate: [0.8, 2, 4], where: ['residential'],
    callers: ['近隣住民'],
    details: ['隣の部屋で大声で騒いでいる', '公園で若者が花火をして騒いでいる', 'バイクの空ぶかしがうるさい'],
    outcomes: ['関係者に注意、静穏となる', '現着時、該当者なし'],
  },
  {
    key: 'lost', name: '迷子・行方不明者', code: '迷子', priority: 3, minUnits: 1, idealUnits: 3, work: 40,
    rate: [3, 1.5, 0.4], where: ['tourist', 'park', 'shop'],
    callers: ['母親', '施設職員', '家族'],
    details: ['5歳の男の子とはぐれた、青色のTシャツ', '認知症の80代男性が施設から外出し戻らない', '小学生の女の子が帰宅しない'],
    outcomes: ['付近を検索し発見、家族へ引渡し', '駅員が保護していた、無事引渡し'],
  },
  {
    key: 'carbreak', name: '車上ねらい', code: '車上', priority: 3, minUnits: 1, idealUnits: 2, work: 40,
    rate: [1.5, 1.5, 2], where: ['residential', 'any'],
    flee: { p: 0.3, mode: 'foot', afterMin: 2 },
    callers: ['被害者', '駐車場管理人', '目撃者'],
    details: ['コインパーキングで車の窓が割られている', '車内のバッグが盗まれた', '駐車中の車を物色している男がいる'],
    suspects: SUSPECT_DESC,
    outcomes: ['被害届受理、鑑識作業終了', 'マル被確保、窃盗容疑で逮捕'],
    failOutcome: '被害届受理、付近警戒',
  },
  {
    key: 'bosozoku', name: '暴走行為', code: '暴走', priority: 2, minUnits: 2, idealUnits: 3, work: 40,
    rate: [0.2, 0.8, 2.5], where: ['major'], bonus: ['kotsu'],
    flee: { p: 1, mode: 'moto', afterMin: 0 },
    callers: ['近隣住民', 'タクシー運転手', '通行人'],
    details: ['バイク10台くらいが信号無視して蛇行運転', '改造車数台が爆音を上げて周回', 'バイク数台が交差点で旋回を繰り返している'],
    suspects: ['バイク数台、うち1台は赤色タンク', '黒色改造車2台、シャコタン', 'ノーヘルのバイク3台'],
    outcomes: ['追尾の上、運転者を確保', '集団は解散、車両特定し後日捜査'],
    failOutcome: '集団は散開し逃走、ナンバー記録',
  },
  {
    key: 'fraud', name: '特殊詐欺（受け子）', code: '詐欺', priority: 2, minUnits: 2, idealUnits: 3, work: 60,
    rate: [1.5, 0.3, 0], where: ['shop', 'station'], bonus: ['kisou'],
    flee: { p: 0.8, mode: 'foot', afterMin: 6 },
    callers: ['銀行員', 'コンビニ店員', '家族'],
    details: ['高齢者が多額の現金を引き出そうとしている、詐欺の疑い', 'ATMで携帯電話を操作しながら振込をしている高齢女性', '受け子と思われる若い男が被害者宅に向かっている'],
    suspects: ['スーツ姿の若い男、マスク着用', '20代の男、白色シャツ、黒色鞄'],
    outcomes: ['受け子を確保、詐欺未遂で現行犯逮捕', '被害を未然に防止、家族に引継ぎ'],
    failOutcome: '受け子は立ち去り、被害は未然防止',
    transport: 0.6,
  },
  {
    key: 'chikan', name: '痴漢', code: '痴漢', priority: 2, minUnits: 1, idealUnits: 2, work: 60,
    rate: [1.5, 1.5, 0.3], where: ['station'],
    callers: ['駅員', '被害者', '目撃者'],
    details: ['車内で痴漢の被疑者を乗客が確保、駅事務室で待機', '駅構内で女性が盗撮被害、男を駅員が確保'],
    outcomes: ['被疑者を署へ同行、迷惑防止条例違反で処理'],
    transport: 1,
  },
  {
    key: 'fire', name: '火災（交通規制）', code: '火災', priority: 2, minUnits: 2, idealUnits: 3, work: 90,
    rate: [0.6, 0.6, 0.6], where: ['residential', 'any'],
    callers: ['消防局', '近隣住民'],
    details: ['住宅火災、消防車両多数出場につき交通規制要請', '飲食店から出火、野次馬多数'],
    outcomes: ['鎮火確認、交通規制解除', '鎮火、出火原因を消防と合同調査'],
  },
  {
    key: 'signal', name: '信号機滅灯', code: '信号', priority: 3, minUnits: 1, idealUnits: 2, work: 60,
    rate: [0.5, 0.4, 0.3], where: ['signal'], bonus: ['kotsu'],
    callers: ['通行人', 'タクシー運転手', '交通管制センター'],
    details: ['交差点の信号機が全方向消灯している', '信号機が点滅したまま、交差点で混乱'],
    outcomes: ['手信号による交通整理実施、業者により復旧'],
  },
  {
    key: 'parking', name: '迷惑駐車', code: '駐車', priority: 4, minUnits: 1, idealUnits: 1, work: 15,
    rate: [3, 1.5, 0.5], where: ['residential', 'shop'],
    callers: ['近隣住民', '店員'],
    details: ['車庫の前に車を止められて出られない', '路上駐車でバスが通れない'],
    outcomes: ['運転者に連絡し移動させた', '駐車違反として処理'],
  },
  {
    key: 'sick', name: '急病人（救急協力）', code: '急病', priority: 3, minUnits: 1, idealUnits: 1, work: 20,
    rate: [1.5, 1.5, 1.5], where: ['station', 'hotspot', 'any'],
    callers: ['通行人', '駅員', '119番転送'],
    details: ['路上で高齢男性が倒れている', '駅前で女性がうずくまっている'],
    outcomes: ['救急隊に引継ぎ', '意識回復、家族へ引継ぎ'],
  },
];

export const TYPE_BY_KEY = new Map(INCIDENT_TYPES.map((t) => [t.key, t]));

export const PRIORITY_LABEL: Record<number, string> = { 1: '最優先', 2: '優先', 3: '通常', 4: '低' };
