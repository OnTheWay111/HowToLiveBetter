// 覆盖判断的单测：不调用 API，检查 assessCoverage() 在几类问题上的模式。
// 这个判断决定提示词注入 partial / none，是「不要硬套条目」的第一道闸。
//
//   node tools/ask/check-coverage.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCorpus, rankEntries, assessCoverage, buildMessages } from '../../ask/agent.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => readFileSync(resolve(ROOT, p), 'utf8');
const readme = read('README.md');
const files = readdirSync(resolve(ROOT, 'book')).filter(f => f.endsWith('.md')).sort();
const corpus = createCorpus(readme, Object.fromEntries(files.map(f => ['book/' + f, read('book/' + f)])));

const CASES = [
  {
    q: '目前夫妻双方都在北京互联网大厂工作，但是都面临超过35岁的职业挑战，请评估全家移民到海南省澄迈县老城镇怎么样？听说那边的教育也很不错，气候、消费、环境都很好。家中育有2娃（大的5岁上幼儿园大班，小的不到1岁）',
    mode: 'partial', why: '搬迁/移居，书里没有当地数据，但有社保医保等部分条目',
  },
  { q: '澄迈县老城镇的房价大概多少？', mode: 'none', why: '具体地点的房价，书里没有当地数据' },
  { q: '海南气候怎么样？', mode: 'none', why: '具体地点的事实，书里没有当地数据' },
  { q: '推荐一款四千元左右的手机', mode: 'none', why: '具体商品推荐，书里没有' },
  { q: '北京哪家医院治胃病最好？', mode: 'none', why: '具体机构推荐，书里没有' },
  { q: '替朋友担保签不签？', mode: 'auto', why: '书里有直接的担保条目' },
  { q: '45 岁要不要做胃镜？', mode: 'auto', why: '书里有直接的胃镜筛查条目' },
  { q: '上海租房押金不退怎么办？', mode: 'partial', why: '地方执行有差异，但书里有租房押金通用条目' },
  { q: '北京公积金怎么提取？', mode: 'partial', why: '地方政策有差异，但书里有公积金通用条目' },
];

let fail = 0;
for (const c of CASES) {
  const hits = rankEntries(c.q, corpus, { topK: 12 });
  const got = assessCoverage(c.q, hits, corpus);
  let ok = got.mode === c.mode;
  let injectOk = true;
  if (got.mode !== 'auto') {
    const msgs = buildMessages({ question: c.q, profile: null, hits, coverage: got });
    const user = msgs[1].content;
    injectOk = got.mode === 'partial'
      ? /系统事前判定：只覆盖一部分/.test(user) && /不要用「先做这几条」硬套/.test(user) && /书里怎么说/.test(user) && /原文数字/.test(user)
      : /系统事前判定：书里没有直接答案/.test(user) && /不要硬套条目/.test(user);
    ok = ok && injectOk;
  }
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${got.mode.padEnd(7)} ${c.q.slice(0, 34)}  (${c.why})`);
  if (!ok) console.log(`  期望 ${c.mode}，实际 ${got.mode}；注入${injectOk ? '正常' : '缺失'}；原因：${got.reason}`);
}
if (fail) {
  console.error(`\n覆盖判断失败 ${fail} 条`);
  process.exitCode = 1;
} else {
  console.log(`\n覆盖判断通过：${CASES.length} 条`);
}
