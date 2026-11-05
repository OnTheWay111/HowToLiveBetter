// 本地冒烟用的假模型服务 + 静态文件服务器。零依赖，只给开发测试用，不参与线上构建。
//
//   node tools/ask/mock-server.mjs           # 默认 http://127.0.0.1:8787/ask.html
//   node tools/ask/mock-server.mjs 9000
//
// 它做两件事：
// 1. 把仓库根目录当静态站点发出去（ask.html 需要从这里取 README.md 和 book/）；
// 2. 在 /v1/chat/completions 假装一个 OpenAI 兼容接口，把请求里检索到的条目拼成
//    一段带「第 X 节第 Y 条」的回答，用 SSE 流式吐回来。
// 这样不填真实 API Key 也能验证页面的流式显示、引用跳转和引用校验。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function serveStatic(req, res, url) {
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '') path = '/ask.html';
  const abs = normalize(resolve(ROOT, '.' + path));
  if (!abs.startsWith(ROOT + sep) || abs.includes(sep + '.git' + sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  let info;
  try { info = await stat(abs); } catch (e) { res.writeHead(404); res.end('not found'); return; }
  if (info.isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const data = await readFile(abs);
  res.writeHead(200, { 'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}

/** 从提示词里把「资料 N」块里的条目编号和标题抠出来，拼一段像样的 mock 回答。 */
function entriesFromPrompt(text) {
  const out = [];
  const re = /【条目】第\s*(\d+)\s*节第\s*(\d+)\s*条（([^）\n]+)）/g;
  let m;
  while ((m = re.exec(text)) && out.length < 6) out.push({ sec: m[1], n: m[2], title: m[3].trim() });
  const humans = [...text.matchAll(/说人话：([^\n]+)/g)].map(x => x[1].trim());
  return out.map((e, i) => ({ ...e, human: humans[i] || '' }));
}

function partialAnswer() {
  return [
    '### 先说结论',
    '书里没有澄迈的学校、房价、岗位和气候数据，不能替你们判断全家搬过去合不合适。能帮上的是把这件事拆成几笔可以核实的账，下面每笔都标清楚哪些来自书、哪些需要你们自己查。',
    '',
    '### 这件事要分几笔算（不是书里的内容）',
    '- **收入与职业**：先算迁过去以后靠什么收入，能不能保留北京的工作。书里没有海南岗位和薪资数据。',
    '- **孩子教育**：5 岁大班和不到 1 岁的孩子分别要解决幼儿园/入园、学籍和转学。书里没有澄迈学校质量、学位和招生数据。',
    '- **住房与生活成本**：书里没有老城镇的房租、房价和日常开支，只能给你们一个算法：把现在的月支出逐项列出来，再乘上预计的变动。',
    '- **社保医保户口**：这一块书里有直接能用的条目，见下一节。',
    '- **气候与环境**：书里没有当地气候、空气和医疗资源数据，建议实地住一段时间再决定。',
    '',
    '### 书里能直接帮上的',
    '- **换城市工作时把养老和医保关系转到新参保地，缴费年限接着累计，别办退保**（第 19 节第 19 条）。',
    '- **跨省异地就医之前先在本地问一句必要性，按当地要求备案**（第 24 节第 4 条）。',
    '',
    '### 你需要去核实',
    '- 澄迈/老城对应片区的幼儿园和小学学位、招生范围、转学条件；问当地教育局。',
    '- 你们目标岗位在当地或远程的实际收入；问招聘网站、在当地工作的同行。',
    '- 房租、房价、日常开支；问当地中介、自己住一周。',
    '- 户口、社保、医保转移的具体办理口径；问当地人社和医保经办机构。',
    '',
    '### 决定前可以先做的动作（不是书里的内容）',
    '先不要卖房、不要辞职。可以一方先过去住一到两周，按上面的清单逐项核实，再决定要不要全家迁。',
    '',
    '<!-- 追问',
    JSON.stringify({
      questions: [
        { q: '你们迁过去后主要靠什么收入？', options: ['保留北京远程工作', '在当地找工作', '自己创业', '还没想好'], multi: false },
        { q: '孩子教育打算走哪条路？', options: ['当地公立', '私立/国际学校', '先租房再看', '还没定'], multi: false },
        { q: '户口和社保是否准备迁？', options: ['都迁', '只迁社保', '先不迁', '不清楚'], multi: false },
      ],
    }, null, 0),
    '-->',
  ].join('\n');
}

function decisionAnswer() {
  return JSON.stringify({
    title: '继续通勤还是搬近',
    options: [
      { id: 'keep', label: '继续通勤', summary: '保留现在的工作和收入', fitsFor: ['收入差距已经兑现的人', '能接受长通勤的人'] },
      { id: 'move', label: '搬近', summary: '缩短通勤但住房开支增加', fitsFor: ['把时间和睡眠看得更重的人'] },
    ],
    criteria: [
      { id: 'income', label: '收入与职业', description: '税后收入、职业机会是否兑现', importance: 3 },
      { id: 'time', label: '时间与睡眠', description: '每天实际可省下的通勤时间', importance: 3 },
      { id: 'housing', label: '住房成本', description: '房租、房价和搬家的净增支出', importance: 3 },
      { id: 'health', label: '健康与疲劳', description: '疲劳驾驶、久坐和睡眠', importance: 2 },
      { id: 'family', label: '家庭与稳定', description: '接送、陪伴和试错成本', importance: 2 },
    ],
    assessments: [
      { optionId: 'keep', criterionId: 'income', state: 'benefit', reason: '保留现在的高收入和已经兑现的机会。', source: 'user', confidence: 'high' },
      { optionId: 'move', criterionId: 'income', state: 'neutral', reason: '换住处本身不改变工作。', source: 'user', confidence: 'medium' },
      { optionId: 'keep', criterionId: 'time', state: 'cost', reason: '每天往返两小时。', source: 'user', confidence: 'high' },
      { optionId: 'move', criterionId: 'time', state: 'benefit', reason: '单程缩短后每天能省出休息时间。', source: 'general', confidence: 'medium' },
      { optionId: 'keep', criterionId: 'housing', state: 'benefit', reason: '不用增加房租。', source: 'user', confidence: 'high' },
      { optionId: 'move', criterionId: 'housing', state: 'unknown', reason: '还没拿到真实房源报价。', source: 'unknown', confidence: 'low' },
      { optionId: 'keep', criterionId: 'health', state: 'cost', reason: '长通勤增加疲劳驾驶风险。', source: 'general', confidence: 'medium' },
      { optionId: 'move', criterionId: 'health', state: 'benefit', reason: '少开车、多一点睡眠。', source: 'general', confidence: 'medium' },
      { optionId: 'keep', criterionId: 'family', state: 'neutral', reason: '现状。', source: 'general', confidence: 'low' },
      { optionId: 'move', criterionId: 'family', state: 'benefit', reason: '多出的时间可以陪家人。', source: 'general', confidence: 'low' },
    ],
    unknowns: ['搬近后每月净增多少房租', '每天实际能省下多少分钟'],
  });
}

function answerFor(prompt, question, model) {
  if (/【决策任务】/.test(prompt)) return decisionAnswer();
  if (model === 'partial-model') return partialAnswer();
  const entries = entriesFromPrompt(prompt);
  const bad = /测试坏引用/.test(question);
  const lines = [];
  lines.push('### 一句话结论');
  lines.push('这是本地 mock 回答，只用来测页面：真实回答要你配置 API Key 后由模型生成。按书里的条目，先看下面这几条。');
  lines.push('');
  lines.push('### 先做这几条');
  if (entries.length) {
    entries.slice(0, 3).forEach((e, i) => {
      const human = e.human ? e.human.slice(0, 120) : '按条目说的做。';
      const short = e.title.length > 18 ? e.title.slice(0, 18) + '…' : e.title;
      lines.push(`${i + 1}. **先看「${short}」这条** ${human}（第 ${e.sec} 节第 ${e.n} 条）`);
    });
  } else {
    lines.push('1. 这次没有检索到条目（mock 收到的提示词里没有「资料」块）。');
  }
  lines.push('');
  lines.push('### 别做 / 不用做的');
  lines.push('- 这条由 mock 生成，不做真实判断；看页面上的引用能不能点回原文。');
  lines.push('');
  lines.push('### 书里没写的');
  lines.push('- mock 只用来验证界面，不构成任何建议。');
  lines.push('');
  lines.push('### 账目对照（mock 表格）');
  lines.push('| 账目 | 要看什么 |');
  lines.push('| --- | --- |');
  lines.push('| 收入 | 实际到手多少 |');
  lines.push('| 支出 | 实际增加多少 |');
  if (bad) {
    lines.push('');
    lines.push('### 引用校验测试');
    lines.push('- 第 99 节第 99 条（这一条不存在，用来测引用校验）。');
  }
  // 模拟模型的「追问」隐藏块，用来测页面的交互式选项；问题里带「不生成追问」时不发
  if (!/不生成追问/.test(question)) {
  lines.push('');
  lines.push('<!-- 追问');
  lines.push(JSON.stringify({
    questions: [
      { q: '对方和你是什么关系？', options: ['朋友', '亲戚', '同事', '其他'], multi: false },
      { q: '现在到哪一步了？', options: ['还没答复', '已经签了', '只是打听', '记不清'], multi: false },
    ],
  }, null, 0));
  lines.push('-->');
  }
  return lines.join('\n');
}

function streamAnswer(res, text, { delay = 8, reasoning = '' } = {}) {
  cors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const pieces = [];
  for (let i = 0; i < text.length; i += 6) pieces.push(text.slice(i, i + 6));
  let i = 0;
  let reasoningSent = false;
  const tick = () => {
    if (res.writableEnded) return;
    if (reasoning && !reasoningSent) {
      reasoningSent = true;
      const chunk = { id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }] };
      res.write('data: ' + JSON.stringify(chunk) + '\n\n');
      setTimeout(tick, delay);
      return;
    }
    if (i >= pieces.length) { res.write('data: [DONE]\n\n'); res.end(); return; }
    const chunk = { id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: pieces[i++] }, finish_reason: null }] };
    res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    setTimeout(tick, delay);
  };
  setTimeout(tick, 30);
}

async function handleChat(req, res) {
  // 测试用：只认 mock-key，方便页面验证 401 的处理
  const auth = String(req.headers.authorization || '');
  if (auth !== 'Bearer mock-key') {
    sendJson(res, 401, { error: { message: 'invalid api key (mock 只认 mock-key)' } });
    return;
  }
  let body = '';
  try { body = await readBody(req); } catch (e) { sendJson(res, 413, { error: { message: 'body too large' } }); return; }
  let json;
  try { json = JSON.parse(body); } catch (e) { sendJson(res, 400, { error: { message: 'invalid json' } }); return; }
  // 模拟 OpenAI 推理模型对参数的挑剔：GPT-6 之类不能带 temperature / max_tokens。
  // compat-model 是专门用来测「页面自动去掉温度、换成 max_completion_tokens 再重试」的。
  if (/^gpt-6/i.test(String(json.model || '')) || json.model === 'compat-model') {
    if (json.temperature !== undefined || json.top_p !== undefined) {
      sendJson(res, 400, { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", type: 'invalid_request_error', param: 'temperature', code: 'unsupported_parameter' } });
      return;
    }
    if (json.max_tokens !== undefined) {
      sendJson(res, 400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error', param: 'max_tokens', code: 'unsupported_parameter' } });
      return;
    }
  }
  const messages = Array.isArray(json.messages) ? json.messages : [];
  const lastUser = [...messages].reverse().find(m => m && m.role === 'user');
  const prompt = lastUser ? String(lastUser.content || '') : '';
  const qm = /【问题】\n([\s\S]*?)\n\n【可用条目】/.exec(prompt);
  const question = qm ? qm[1].trim() : prompt.slice(0, 200);
  const text = answerFor(prompt, question, json.model);
  const isReasoningMock = json.model === 'reasoning-model';
  if (json.stream === false) {
    const message = { role: 'assistant', content: text };
    if (isReasoningMock) message.reasoning_content = '先复述用户的问题，再查书里的条目；这一步只用于测试思考过程展示。';
    sendJson(res, 200, { id: 'mock', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'stop' }] });
    return;
  }
  streamAnswer(res, text, {
    delay: json.model === 'slow-model' || isReasoningMock ? 25 : 8,
    reasoning: isReasoningMock ? '先复述用户的问题，再查书里的条目；这一步只用于测试思考过程展示。' : '',
  });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (req.method === 'POST' && /\/chat\/completions$/.test(url.pathname)) { handleChat(req, res); return; }
  if (req.method === 'GET' && /\/models$/.test(url.pathname)) { sendJson(res, 200, { object: 'list', data: [{ id: 'mock-model', object: 'model' }] }); return; }
  if (req.method === 'GET') { serveStatic(req, res, url); return; }
  res.writeHead(405); res.end('method not allowed');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock 服务已启动：http://127.0.0.1:${PORT}/ask.html`);
  console.log(`静态目录：${ROOT}`);
  console.log(`接口地址（填在页面设置里的「自定义」）：http://127.0.0.1:${PORT}/v1`);
});
