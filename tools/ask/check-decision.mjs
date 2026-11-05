// 决策打分板单测：四态状态、三档重要性、未知排除、平局和权重敏感性。
//
//   node tools/ask/check-decision.mjs
import { normalizeDecision, scoreDecision, sensitivity, STATE_SIGN, importanceMap } from '../../ask/decision.js';

let fail = 0;
function ok(cond, label, extra) {
  if (!cond) { fail++; console.log('✗ ' + label + (extra ? '：' + extra : '')); }
  else console.log('✓ ' + label);
}

const raw = {
  title: '继续通勤还是搬近',
  options: [
    { id: 'keep', label: '继续通勤', summary: '保留现在的工作', fitsFor: ['收入差已兑现的人'] },
    { id: 'move', label: '搬近', summary: '缩短通勤但房租上涨', fitsFor: ['时间比钱重要的人'] },
  ],
  criteria: [
    { id: 'income', label: '收入与职业', description: '税后收入与机会', importance: 3 },
    { id: 'time', label: '时间与睡眠', description: '每天可省下多少时间', importance: 3 },
    { id: 'housing', label: '住房成本', description: '房租和搬家成本', importance: 3 },
    { id: 'health', label: '健康与疲劳', description: '驾驶和睡眠', importance: 2 },
    { id: 'family', label: '家庭与稳定', description: '接送和试错成本', importance: 2 },
  ],
  assessments: [
    { optionId: 'keep', criterionId: 'income', state: 'benefit', reason: '保留高收入', source: 'user', confidence: 'high' },
    { optionId: 'move', criterionId: 'income', state: 'neutral', reason: '不改变工作', source: 'user', confidence: 'medium' },
    { optionId: 'keep', criterionId: 'time', state: 'cost', reason: '每天两小时', source: 'user', confidence: 'high' },
    { optionId: 'move', criterionId: 'time', state: 'benefit', reason: '省下通勤', source: 'general', confidence: 'medium' },
    { optionId: 'keep', criterionId: 'housing', state: 'benefit', reason: '不用增加房租', source: 'user', confidence: 'high' },
    { optionId: 'move', criterionId: 'housing', state: 'unknown', reason: '还没报价', source: 'unknown', confidence: 'low' },
    { optionId: 'keep', criterionId: 'health', state: 'cost', reason: '疲劳驾驶', source: 'general', confidence: 'medium' },
    { optionId: 'move', criterionId: 'health', state: 'benefit', reason: '少开车', source: 'general', confidence: 'medium' },
    { optionId: 'keep', criterionId: 'family', state: 'neutral', reason: '', source: 'general', confidence: 'low' },
    { optionId: 'move', criterionId: 'family', state: 'benefit', reason: '多陪家人', source: 'general', confidence: 'low' },
  ],
};

const d = normalizeDecision(raw);
ok(d && d.options.length === 2 && d.criteria.length === 5, '规范化选项和因素');
ok(STATE_SIGN.benefit === 1 && STATE_SIGN.cost === -1 && STATE_SIGN.unknown === null, '四态映射正确');

const s = scoreDecision(d);
ok(s.excluded.some(x => x.criterionId === 'housing'), '任一选项不知道时，该因素先不计入');
ok(s.knownWeight === 10 && s.totalWeight === 13, '未知因素从排名权重里排除', JSON.stringify({ known: s.knownWeight, total: s.totalWeight }));
ok(s.top != null && s.top.id === 'move', '按状态和权重算出倾向', JSON.stringify(s.ranking.map(x => [x.id, x.weighted])));
ok(s.confidence !== 'high', '有未知因素时结论强度不标成高', s.confidence);
ok(s.rows.every(r => Number.isFinite(r.weighted)), '不产生假的小数分数');

const imp = importanceMap(d);
ok(imp.income === 3 && imp.health === 2, '默认重要性来自模型建议');
// 另一组只用来测「重要性变化会反转」：收入 vs 时间各 3 和 1
const flipRaw = {
  options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  criteria: [
    { id: 'income', label: '收入', importance: 3 },
    { id: 'time', label: '时间', importance: 1 },
    { id: 'other', label: '其他', importance: 1 },
  ],
  assessments: [
    { optionId: 'a', criterionId: 'income', state: 'benefit' },
    { optionId: 'b', criterionId: 'income', state: 'cost' },
    { optionId: 'a', criterionId: 'time', state: 'cost' },
    { optionId: 'b', criterionId: 'time', state: 'benefit' },
    { optionId: 'a', criterionId: 'other', state: 'neutral' },
    { optionId: 'b', criterionId: 'other', state: 'neutral' },
  ],
};
const fd = normalizeDecision(flipRaw);
const baseFlip = scoreDecision(fd, { income: 2, time: 1, other: 1 });
const flipped = scoreDecision(fd, { income: 2, time: 3, other: 1 });
ok(baseFlip.top && baseFlip.top.id === 'a', '改重要性前的排名');
ok(flipped.top && flipped.top.id === 'b' && flipped.top.id !== baseFlip.top.id, '改重要性可以让结论反转', JSON.stringify({ before: baseFlip.top.id, after: flipped.top.id }));
const sens = sensitivity(fd, { income: 2, time: 1, other: 1 });
ok(Array.isArray(sens) && sens.length > 0, '给出翻转条件', JSON.stringify(sens.slice(0, 2)));

const allUnknown = normalizeDecision({ ...raw, assessments: [] });
ok(allUnknown && scoreDecision(allUnknown).status === 'insufficient', '全部不知道时不硬给推荐');

ok(normalizeDecision({ options: [], criteria: [] }) === null, '非法结构返回 null');
ok(normalizeDecision({ ...raw, options: raw.options.map(o => ({ ...o, label: '' })) }) === null, '没有选项返回 null');

if (fail) { console.error(`\n决策板检查失败 ${fail} 条`); process.exitCode = 1; }
else console.log('\n决策板检查通过');
