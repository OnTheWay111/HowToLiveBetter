// 决策打分板：只用「有好处 / 有坏处 / 没有影响 / 不知道」四种状态，
// 加上「很重要 / 一般 / 不太重要」三档权重，由前端确定性计算。
//
// 关键规则：
// 1. 模型只负责提出选项、因素和判断状态，不负责算总分。
// 2. 某个因素只要有一个选项是「不知道」，整项先不计入排名（不能把不知道当 0）。
// 3. 不输出 0~100 的假精确分数，只输出净支持、待补项和结论强度。
export const STATE_VALUES = ['benefit', 'cost', 'neutral', 'unknown'];
export const STATE_SIGN = { benefit: 1, cost: -1, neutral: 0, unknown: null };
export const IMPORTANCE_VALUES = { high: 3, medium: 2, low: 1 };
export const IMPORTANCE_LABEL = { 3: '很重要', 2: '一般', 1: '不太重要' };
export const STATE_LABEL = {
  benefit: '有好处',
  cost: '有坏处',
  neutral: '没有影响',
  unknown: '不知道',
};
export const SOURCE_LABEL = {
  book: '书里',
  user: '你提供',
  general: '通用判断',
  unknown: '待核实',
};
export const CONFIDENCE_LABEL = { high: '高', medium: '中', low: '低' };

const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const oneOf = (v, allowed, fallback) => allowed.includes(v) ? v : fallback;

/** 校验模型返回的决策 JSON；不合法就返回 null，由页面退回普通回答。 */
export function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const options = (Array.isArray(raw.options) ? raw.options : []).slice(0, 4).map((o, i) => ({
    id: str(o && o.id, 40) || 'option-' + (i + 1),
    label: str(o && o.label, 40),
    summary: str(o && o.summary, 160),
    fitsFor: (Array.isArray(o && o.fitsFor) ? o.fitsFor : []).map(x => str(x, 60)).filter(Boolean).slice(0, 3),
  })).filter(o => o.label);
  const criteria = (Array.isArray(raw.criteria) ? raw.criteria : []).slice(0, 6).map((c, i) => ({
    id: str(c && c.id, 40) || 'criterion-' + (i + 1),
    label: str(c && c.label, 40),
    description: str(c && c.description, 160),
    importance: oneOf(Number(c && c.importance), [3, 2, 1], 2),
  })).filter(c => c.label);
  if (options.length < 2 || criteria.length < 3) return null;
  if (new Set(options.map(o => o.id)).size !== options.length) return null;
  if (new Set(criteria.map(c => c.id)).size !== criteria.length) return null;

  const byKey = new Map();
  for (const a of (Array.isArray(raw.assessments) ? raw.assessments : [])) {
    if (!a || typeof a !== 'object') continue;
    const optionId = str(a.optionId, 40), criterionId = str(a.criterionId, 40);
    if (!options.some(o => o.id === optionId) || !criteria.some(c => c.id === criterionId)) continue;
    byKey.set(optionId + '::' + criterionId, {
      state: oneOf(a.state, STATE_VALUES, 'unknown'),
      reason: str(a.reason, 300),
      source: oneOf(a.source, ['book', 'user', 'general', 'unknown'], 'unknown'),
      confidence: oneOf(a.confidence, ['high', 'medium', 'low'], 'low'),
    });
  }
  const assessments = [];
  for (const o of options) {
    for (const c of criteria) {
      assessments.push({
        optionId: o.id,
        criterionId: c.id,
        ...(byKey.get(o.id + '::' + c.id) || { state: 'unknown', reason: '', source: 'unknown', confidence: 'low' }),
      });
    }
  }
  return {
    title: str(raw.title, 80) || '决策打分板',
    options,
    criteria,
    assessments,
    defaultImportance: Object.fromEntries(criteria.map(c => [c.id, c.importance])),
    unknowns: (Array.isArray(raw.unknowns) ? raw.unknowns : []).map(x => str(x, 120)).filter(Boolean).slice(0, 8),
  };
}

/** 把用户的权重整理成 1~3，缺省用模型给的建议。 */
export function importanceMap(decision, override = {}) {
  const out = {};
  for (const c of decision.criteria) {
    const v = Number(override[c.id] != null ? override[c.id] : (decision.defaultImportance && decision.defaultImportance[c.id]));
    out[c.id] = v === 3 || v === 2 || v === 1 ? v : 2;
  }
  return out;
}

export function scoreDecision(decision, override = {}) {
  const importance = importanceMap(decision, override);
  const byKey = new Map(decision.assessments.map(a => [a.optionId + '::' + a.criterionId, a]));
  const excluded = [];
  const included = [];
  for (const c of decision.criteria) {
    const cells = decision.options.map(o => byKey.get(o.id + '::' + c.id));
    const unknownOptions = decision.options.filter((o, i) => !cells[i] || cells[i].state === 'unknown');
    if (unknownOptions.length) {
      excluded.push({
        criterionId: c.id, label: c.label, importance: importance[c.id],
        unknownOptions: unknownOptions.map(o => ({ id: o.id, label: o.label })),
      });
    } else {
      included.push({ criterion: c, cells });
    }
  }
  const knownWeight = included.reduce((n, x) => n + importance[x.criterion.id], 0);
  const totalWeight = decision.criteria.reduce((n, c) => n + importance[c.id], 0);
  const coverage = totalWeight ? knownWeight / totalWeight : 0;
  const rows = decision.options.map(o => {
    let weighted = 0, support = 0, oppose = 0, neutral = 0;
    const benefits = [], costs = [], noEffect = [];
    included.forEach(({ criterion, cells }) => {
      const a = cells[decision.options.findIndex(x => x.id === o.id)];
      const sign = STATE_SIGN[a.state];
      const w = importance[criterion.id];
      weighted += w * sign;
      if (sign > 0) { support += w; benefits.push({ criterionId: criterion.id, label: criterion.label, reason: a.reason, source: a.source }); }
      else if (sign < 0) { oppose += w; costs.push({ criterionId: criterion.id, label: criterion.label, reason: a.reason, source: a.source }); }
      else { neutral += w; noEffect.push({ criterionId: criterion.id, label: criterion.label }); }
    });
    return {
      id: o.id, label: o.label, summary: o.summary, fitsFor: o.fitsFor,
      weighted, normalized: knownWeight ? weighted / knownWeight : 0,
      supportWeight: support, opposeWeight: oppose, neutralWeight: neutral,
      benefits, costs, noEffect,
    };
  });
  const ranking = rows.slice().sort((a, b) => b.weighted - a.weighted || b.normalized - a.normalized || a.label.localeCompare(b.label));
  const top = ranking[0] || null;
  const second = ranking[1] || null;
  const margin = top && second ? top.weighted - second.weighted : 0;
  const tie = !!(top && second && top.weighted === second.weighted);
  let status = 'recommended';
  if (!included.length) status = 'insufficient';
  else if (coverage < 0.5) status = 'insufficient';
  else if (tie) status = 'tie';
  const confidence = !included.length ? 'low'
    : (coverage >= 0.8 && margin >= 2) ? 'high'
    : (coverage >= 0.5 ? 'medium' : 'low');
  return {
    importance, included, excluded, rows, ranking, top, second, margin, tie, status, confidence, coverage,
    knownWeight, totalWeight,
  };
}

/** 找“如果这项重要性变一档，结论会不会反转”。只比较前两名。 */
export function sensitivity(decision, override = {}) {
  const base = scoreDecision(decision, override);
  if (!base.top || base.ranking.length < 2) return [];
  const currentTop = base.top.id;
  const out = [];
  for (const c of decision.criteria) {
    const cur = base.importance[c.id];
    for (const next of [1, 2, 3]) {
      if (next === cur) continue;
      const alt = scoreDecision(decision, { ...override, [c.id]: next });
      if (!alt.top || alt.top.id === currentTop) continue;
      out.push({
        criterionId: c.id,
        label: c.label,
        current: cur,
        alternative: next,
        from: currentTop,
        to: alt.top.id,
        alternativeLabel: alt.top.label,
      });
    }
  }
  return out;
}
