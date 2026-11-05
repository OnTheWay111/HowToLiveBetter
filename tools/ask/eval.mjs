// 检索评测：拿 tools/ask/cases.json 的 42 道题跑一遍 ask/agent.js 的检索，
// 看期望条目有没有进前 K。不需要 API Key，跑的是网页上同一份检索代码。
//
//   node tools/ask/eval.mjs              # 只跑检索，打印失败题
//   node tools/ask/eval.mjs --check      # 阈值不达标时退出码 1（可挂 CI）
//   node tools/ask/eval.mjs --top 10     # 改判定用的 K，默认 10
//
// 想连真实模型跑完整回答：设置 ASK_API_KEY、ASK_BASE_URL、ASK_MODEL 后加 --gen，
// 会调用 OpenAI 兼容接口并统计回答里的引用是否都能对回本次检索结果。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCorpus, rankEntries, buildMessages, validateCitations, entryLabel } from '../../ask/agent.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => readFileSync(resolve(ROOT, p), 'utf8');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const GEN = args.includes('--gen');
const TOP = (() => { const i = args.indexOf('--top'); const v = i >= 0 ? Number(args[i + 1]) : 10; return Number.isFinite(v) && v > 0 ? v : 10; })();

function loadCorpus() {
  const readme = read('README.md');
  const files = [...new Set([...readme.matchAll(/\]\((book\/[^)]+\.md)\)/g)].map(m => m[1]))].sort();
  const parts = Object.fromEntries(files.map(f => [f, read(f)]));
  return createCorpus(readme, parts);
}

function loadCases() {
  const p = resolve(ROOT, 'tools/ask/cases.json');
  if (!existsSync(p)) throw new Error('缺少 tools/ask/cases.json');
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(arr) || !arr.length) throw new Error('cases.json 为空');
  return arr;
}

const TYPE_LABEL = { in_book: '书内', emergency: '急症', suicide: '自杀', legal: '法律', personalized: '个人情况', partial: '部分覆盖', out_of_book: '书外' };

async function main() {
  const corpus = loadCorpus();
  const cases = loadCases();
  const rows = [];
  for (const c of cases) {
    const hits = rankEntries(c.question, corpus, { profile: c.profile || null, topK: Math.max(TOP, 12) });
    const refs = hits.map(h => `${h.entry.sec}-${h.entry.n}`);
    const expect = (c.expect || []).map(e => `${e.sec}-${e.n}`);
    const rankOf = ref => { const i = refs.indexOf(ref); return i < 0 ? Infinity : i + 1; };
    const ranks = expect.map(rankOf);
    rows.push({
      c, hits, refs, expect, ranks,
      top1: expect.length ? ranks.some(r => r === 1) : null,
      top3: expect.length ? ranks.some(r => r <= 3) : null,
      top10: expect.length ? ranks[0] <= TOP : null,
      allTop10: expect.length ? ranks.every(r => r <= TOP) : null,
      hitAnyTop: expect.length ? ranks.some(r => r <= TOP) : null,
    });
  }

  const scored = rows.filter(r => r.c.type !== 'out_of_book');
  const pct = (a, b) => b ? `${a}/${b}（${(a / b * 100).toFixed(0)}%）` : '0/0';
  const top1 = scored.filter(r => r.top1).length;
  const top3 = scored.filter(r => r.top3).length;
  const topK = scored.filter(r => r.hitAnyTop).length;
  const all = scored.filter(r => r.allTop10).length;

  console.log(`\n检索评测：${cases.length} 题，判定前 ${TOP} 条；正文 ${corpus.entryCount} 条 / ${corpus.sections.length} 节\n`);
  console.log(`书内类题：top1 ${pct(top1, scored.length)}　top3 ${pct(top3, scored.length)}　top${TOP} ${pct(topK, scored.length)}　期望全中 ${pct(all, scored.length)}`);

  for (const type of Object.keys(TYPE_LABEL)) {
    const list = rows.filter(r => r.c.type === type);
    if (!list.length) continue;
    if (type === 'out_of_book') {
      console.log(`\n[${TYPE_LABEL[type]}] ${list.length} 题（期望：书里没写；下面只列检索到的东西，供判断会不会误导）`);
      for (const r of list) console.log(`  - ${r.c.id}：${r.c.question}\n    top1：${r.refs[0] ? `第 ${r.hits[0].entry.sec} 节第 ${r.hits[0].entry.n} 条 ${r.hits[0].entry.title}` : '（无命中）'}`);
      continue;
    }
    const t1 = list.filter(r => r.top1).length;
    const t3 = list.filter(r => r.top3).length;
    const tk = list.filter(r => r.hitAnyTop).length;
    console.log(`\n[${TYPE_LABEL[type]}] ${list.length} 题：top1 ${t1}　top3 ${t3}　top${TOP} ${tk}`);
  }

  const failures = scored.filter(r => !r.allTop10);
  if (failures.length) {
    console.log('\n有期望条目没进前 ' + TOP + ' 的题：');
    for (const r of failures) {
      console.log(`\n  ✗ ${r.c.id}：${r.c.question}`);
      console.log(`    期望：${r.expect.join('、')}（实际名次：${r.ranks.map(x => x === Infinity ? '未进前 12' : x).join('、')}）`);
      for (const [i, h] of r.hits.slice(0, 5).entries()) {
        console.log(`    命中 ${i + 1}. ${entryLabel(h.entry)}  [${h.score.toFixed(1)}]`);
      }
    }
  } else {
    console.log(`\n✓ 所有期望条目都在前 ${TOP} 条里。`);
  }

  // 打印每题的 top1，方便人工看检索质量
  console.log('\n逐题 top1：');
  for (const r of rows) {
    const first = r.hits[0];
    const mark = r.expect.length && r.ranks.some(x => x === 1) ? '✓' : r.expect.length ? '·' : ' ';
    console.log(` ${mark} ${r.c.id.padEnd(28)} ${r.c.question.slice(0, 24)} → ${first ? entryLabel(first.entry) : '（无命中）'}`);
  }

  if (GEN) await genEval(rows, corpus);
  if (CHECK) {
    const ok = scored.length > 0 && topK === scored.length && top3 / scored.length >= 0.9 && top1 / scored.length >= 0.8;
    console.log(`\n${ok ? '✓ 达标' : '✗ 未达标'}：top${TOP} 应全中、top3 至少 90%、top1 至少 80%`);
    if (!ok) process.exitCode = 1;
  }
}

/* ---------- 可选：连真实模型跑完整回答，统计引用准确率 ---------- */
async function genEval(rows, corpus) {
  const key = process.env.ASK_API_KEY || '';
  const baseUrl = (process.env.ASK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = process.env.ASK_MODEL || 'deepseek-chat';
  if (!key) { console.log('\n[--gen] 没设置 ASK_API_KEY，跳过完整回答评测。'); return; }
  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';
  console.log(`\n完整回答评测：${model} @ ${baseUrl}（只跑有期望条目的题，会花 API 额度）`);
  let cited = 0, exact = 0, fabricated = 0, ran = 0;
  for (const r of rows) {
    if (!r.expect.length) continue;
    const messages = buildMessages({ question: r.c.question, profile: r.c.profile || null, hits: r.hits });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2400, stream: false }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined,
    });
    if (!res.ok) { console.log(`  ${r.c.id} 请求失败 HTTP ${res.status}`); continue; }
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content || '';
    const v = validateCitations(text, { corpus, hits: r.hits });
    ran++;
    const expectedCited = r.expect.filter(ref => {
      const [sec, n] = ref.split('-');
      return text.includes(`第 ${sec} 节第 ${n} 条`);
    }).length;
    cited += v.citations.length;
    exact += v.ok;
    fabricated += v.invalid;
    console.log(`  ${r.c.id}：引用 ${v.citations.length} 处（不存在 ${v.invalid}，不在本次检索 ${v.outside}），期望条目被引用 ${expectedCited}/${r.expect.length}`);
  }
  console.log(`\n合计 ${ran} 题：引用 ${cited} 处，其中来自本次检索 ${exact} 处、书里不存在 ${fabricated} 处。`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
