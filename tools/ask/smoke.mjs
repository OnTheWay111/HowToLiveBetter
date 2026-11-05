// 页面冒烟测试：起一个本地 mock 模型服务，用无头 Chrome 打开 ask.html，
// 走完「输入问题 → 检索 → 流式回答 → 引用校验」三条路。
//
//   node --experimental-websocket tools/ask/smoke.mjs     # Node 20 要带参数
//   node tools/ask/smoke.mjs                              # Node 22+ 直接跑
//
// Chrome 不在默认位置时用 CHROME=/path/to/Chrome 指定。测试用 localhost 的
// ?dev=mock 钩子，不会读写线上 localStorage，也不会发任何真实 API 请求。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MOCK_PORT = 8787;
const CDP_PORT = 9333;
const timeout = ms => new Promise(r => setTimeout(r, ms));

if (typeof WebSocket === 'undefined') {
  console.error('这个脚本要用全局 WebSocket。Node 20 请加 --experimental-websocket，Node 22 及以上直接跑。');
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error('找不到 Chrome：' + CHROME + '\n用 CHROME=/path/to/Chrome 指定。');
  process.exit(2);
}

const profileDir = mkdtempSync(join(tmpdir(), 'hltb-ask-smoke-'));
let mock = null, chrome = null;
const results = [];

async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 204) return r; } catch (e) {}
    await timeout(200);
  }
  throw new Error('等不到 ' + url);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.events = [];
    this.ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg.id && msg.method) {
        if (msg.method === 'Runtime.exceptionThrown' || msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Log.entryAdded') this.events.push(msg);
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面脚本报错');
    return r && r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function newPage(url) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error('开新标签页失败 HTTP ' + res.status);
  const target = await res.json();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { cdp, target };
}

async function waitPage(cdp) {
  for (let i = 0; i < 120; i++) {
    const state = await cdp.eval(`(() => ({
      ready: !!window.__ASK_READY__,
      done: !!window.__ASK_DONE__,
      boot: document.getElementById('boot')?.innerText || '',
      text: document.querySelector('.msg.bot .answer')?.innerText || '',
      cites: document.querySelectorAll('.msg.bot .cite').length,
      bad: document.querySelectorAll('.msg.bot .cite.bad').length,
      warn: document.querySelectorAll('.msg.bot .cite.warn').length,
      summary: document.querySelector('.msg.bot .cite-summary')?.innerText || '',
      sources: document.querySelectorAll('.msg.bot .src-card').length,
      sourcesText: document.querySelector('.msg.bot .sources')?.innerText || '',
      tables: document.querySelectorAll('.msg.bot .answer table').length,
      scopeText: document.querySelector('.msg.bot .scope-note:not([hidden])')?.innerText || '',
      notes: [...document.querySelectorAll('.msg.bot .retrieval-note,.msg.bot .error-box')].map(x => x.innerText)
    }))()`);
    if (state && state.done) return state;
    if (state && state.boot && /失败/.test(state.boot)) throw new Error('页面加载失败：' + state.boot);
    await timeout(150);
  }
  const errs = (cdp.events || []).map(e => {
    if (e.method === 'Runtime.exceptionThrown') return 'EXCEPTION: ' + (e.params?.exceptionDetails?.exception?.description || e.params?.exceptionDetails?.text || '');
    if (e.method === 'Runtime.consoleAPICalled') return 'CONSOLE ' + e.params?.type + ': ' + (e.params?.args || []).map(a => a.value || a.description || '').join(' ');
    if (e.method === 'Log.entryAdded') return 'LOG ' + e.params?.entry?.level + ': ' + (e.params?.entry?.text || '');
    return e.method;
  }).slice(-10).join('\n');
  throw new Error('等页面回答超时' + (errs ? '\n' + errs : ''));
}

async function waitReady(cdp) {
  for (let i = 0; i < 150; i++) {
    const st = await cdp.eval(`(() => ({ ready: !!window.__ASK_READY__, boot: document.getElementById('boot')?.innerText || '' }))()`);
    if (st && st.ready) return st;
    if (st && /失败/.test(st.boot)) throw new Error('页面加载失败：' + st.boot);
    await timeout(150);
  }
  throw new Error('等页面加载超时');
}

/** 先问后答卡：点「直接回答」并等最终回答。 */
async function clickDirect(cdp, label = '先问后答卡出现了') {
  const r = await cdp.eval(`(() => {
    const card = document.querySelector('.msg.bot .clarify-first');
    if (!card) return { ok: false };
    const btn = [...card.querySelectorAll('button')].find(b => /直接回答/.test(b.textContent || ''));
    if (!btn) return { ok: false, noBtn: true };
    btn.click();
    return { ok: true, qs: card.querySelectorAll('.clarify-q').length };
  })()`);
  assert(r.ok, label, JSON.stringify(r));
  await waitPage(cdp);
  return r;
}

function assert(cond, label, extra) {
  if (cond) { console.log('  ✓ ' + label); results.push({ label, ok: true }); }
  else { console.error('  ✗ ' + label + (extra ? '：' + extra : '')); results.push({ label, ok: false }); }
}

async function run() {
  mock = spawn(process.execPath, [join(ROOT, 'tools/ask/mock-server.mjs'), String(MOCK_PORT)], { cwd: ROOT, stdio: 'ignore' });
  await waitHttp(`http://127.0.0.1:${MOCK_PORT}/ask.html`);

  let chromeLog = '';
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', d => { chromeLog += d; });
  try {
    await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 150);
  } catch (e) {
    throw new Error(e.message + '\nChrome stderr：\n' + chromeLog.slice(-2000));
  }

  console.log('1. 配了 Key（mock 接口）时的完整回答');
  {
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=mock&q=${encodeURIComponent('替朋友担保签不签？')}`);
    const first = await waitPage(cdp);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1600, deviceScaleFactor: 1, mobile: false });
    await timeout(200);
    const firstShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-clarify-first.png', Buffer.from(firstShot.data, 'base64'));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await timeout(200);
    const firstMobShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-clarify-first-mobile.png', Buffer.from(firstMobShot.data, 'base64'));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1600, deviceScaleFactor: 1, mobile: false });
    const cf = await cdp.eval(`(() => {
      const card = document.querySelector('.msg.bot .clarify-first');
      if (!card) return { ok: false };
      const qs = [...card.querySelectorAll('.clarify-q')];
      qs.forEach(q => q.querySelector('.chip')?.click());
      const btn = [...card.querySelectorAll('button')].find(b => /按这些情况回答/.test(b.textContent || ''));
      const disabled = btn ? btn.disabled : true;
      if (btn && !disabled) btn.click();
      return { ok: true, qs: qs.length, disabled, scope: document.querySelector('.msg.bot .scope-note:not([hidden])')?.innerText || '' };
    })()`);
    assert(cf.ok && cf.qs >= 2, '宽泛问题默认先展示引导问题（' + (cf.qs || 0) + ' 项）');
    assert(cf.ok && !cf.disabled, '选完选项后「按这些情况回答」可用');
    const s = await waitPage(cdp);
    assert(/本地 mock 回答/.test(s.text), '回答渲染出来了', s.text.slice(0, 80));
    assert(s.cites >= 2, `引用可点（${s.cites} 处）`);
    assert(s.sources >= 5, `展示检索到的条目（${s.sources} 张卡）`);
    assert(/核对结果/.test(s.summary), '显示核对结果', s.summary);
    assert(s.tables >= 1, 'Markdown 表格渲染成 table', String(s.tables));
    assert(s.bad === 0, '没有标红的无效引用');
    const count = await cdp.eval("document.getElementById('loaded-count')?.textContent || ''");
    const num = /载入 (\d+) 条/.exec(count);
    assert(num && Number(num[1]) > 500, '条目数从正文读出来了（' + count + '）');
    const testOk = await cdp.eval(`(async () => {
      document.getElementById('test').click();
      for (let i = 0; i < 60; i++) {
        const t = document.getElementById('test-result')?.innerText || '';
        if (/连接成功|连接失败/.test(t)) return t;
        await new Promise(r => setTimeout(r, 100));
      }
      return document.getElementById('test-result')?.innerText || '';
    })()`);
    assert(/连接成功/.test(testOk), '「测试连接」能跑通', testOk);
    const src = await cdp.eval(`(() => {
      const cite = document.querySelector('.msg.bot .answer a.cite.num');
      if (!cite) return { ok: false };
      cite.click();
      return {
        ok: true,
        opened: document.querySelectorAll('.msg.bot .src-card[open]').length,
        hasOther: !!document.querySelector('.msg.bot .src-more'),
        citedHead: document.querySelector('.msg.bot .sources-h')?.innerText || ''
      };
    })()`);
    assert(src.ok && src.opened >= 1, '点引用编号会展开对应依据', JSON.stringify(src));
    assert(src.hasOther, '没被引用的检索结果收在「其他检索」里');
    assert(/正文引用/.test(src.citedHead), '来源分成正文引用和其他检索', src.citedHead);
    const basis = await cdp.eval(`(() => {
      const strip = document.querySelector('.msg.bot .answer-section[data-kind="conclusion"] .basis-strip');
      return {
        inConclusion: !!strip,
        items: strip ? strip.querySelectorAll('.basis-item').length : 0,
        viewBtns: strip ? strip.querySelectorAll('[data-entry-open]').length : 0,
        hasHuman: strip ? !!strip.querySelector('.basis-human') : false
      };
    })()`);
    assert(basis.inConclusion && basis.items >= 1, '结论区有依据速览', JSON.stringify(basis));
    assert(basis.viewBtns >= 1 && basis.hasHuman, '依据速览展示说人话并可查看原文', JSON.stringify(basis));
    const entryModal = await cdp.eval(`(async () => {
      const btn = document.querySelector('.msg.bot .basis-strip [data-entry-open]');
      if (!btn) return { ok: false };
      btn.click();
      await new Promise(r => setTimeout(r, 120));
      const d = document.getElementById('entry-panel');
      const body = document.getElementById('entry-body')?.innerText || '';
      return {
        ok: !!(d && d.open),
        body,
        fields: /成本/.test(body) && /收益/.test(body) && /证据等级/.test(body) && /来源/.test(body),
        external: !!document.querySelector('#entry-body a[href*="index.html#e-"]')
      };
    })()`);
    assert(entryModal.ok, '「查看原文」能打开原文弹窗', JSON.stringify(entryModal));
    assert(entryModal.fields, '原文弹窗展示成本、收益、证据和来源', entryModal.body.slice(0, 80));
    assert(entryModal.external, '原文弹窗有检索页原文链接');
    const entryShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-entry.png', Buffer.from(entryShot.data, 'base64'));
    await cdp.eval("document.getElementById('entry-panel')?.close()");
    const cardView = await cdp.eval("!!document.querySelector('.msg.bot .src-card .basis-actions [data-entry-open]')");
    assert(cardView, '依据卡上也有「查看原文」');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1600, deviceScaleFactor: 1, mobile: false });
    await cdp.eval("document.querySelectorAll('.msg.bot .src-card[open]').forEach(c=>c.open=false); document.getElementById('chat').scrollTop = 0; document.querySelector('.msg.bot')?.scrollIntoView({ block: 'start' })");
    await cdp.eval('window.scrollTo(0, 0)');
    await timeout(200);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-smoke.png', Buffer.from(shot.data, 'base64'));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.eval("document.querySelector('.msg.bot .clarify')?.removeAttribute('open'); window.scrollTo(0, 0)");
    await timeout(200);
    const mob = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-mobile.png', Buffer.from(mob.data, 'base64'));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1600, deviceScaleFactor: 1, mobile: false });
    await cdp.eval("document.documentElement.classList.add('dark'); window.scrollTo(0, 0)");
    await timeout(200);
    const dark = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-dark.png', Buffer.from(dark.data, 'base64'));
    await cdp.eval("document.querySelector('.msg.bot .clarify')?.scrollIntoView({ block: 'center' })");
    await timeout(200);
    const clarifyShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-clarify.png', Buffer.from(clarifyShot.data, 'base64'));
    const after = await cdp.eval(`(() => ({
      users: document.querySelectorAll('.msg.user').length,
      bots: document.querySelectorAll('.msg.bot').length,
      supplement: document.querySelector('.msg.bot .supplement-note:not([hidden])')?.innerText || '',
      firstCard: !!document.querySelector('.msg.bot .clarify-first')
    }))()`);
    assert(after.users === 1 && after.bots === 1, '引导后结果写回同一条回答，不重复插入用户消息', JSON.stringify(after));
    assert(/补充情况/.test(after.supplement), '页面保留了补充情况摘要', after.supplement);
    const proc = await cdp.eval(`(() => {
      const p = document.querySelector('.msg.bot .process');
      return p ? {
        hidden: p.hidden,
        open: p.open,
        summary: p.querySelector('.process-summary')?.innerText || '',
        steps: p.querySelectorAll('.process-step').length
      } : null;
    })()`);
    assert(proc && !proc.hidden && proc.steps >= 3, '回答后显示处理过程面板', JSON.stringify(proc));
    assert(/已处理/.test(proc.summary), '过程面板显示耗时和依据数', proc.summary);
    assert(!proc.open, '回答完成后过程面板自动收起', JSON.stringify(proc));
    const settings = await cdp.eval(`(() => {
      document.getElementById('key-status')?.click();
      const d = document.getElementById('settings');
      return { open: !!(d && d.open), testVisible: !!document.getElementById('test')?.offsetParent };
    })()`);
    assert(settings.open && settings.testVisible, '页头 Key 状态能打开设置弹窗', JSON.stringify(settings));
    const modelInfo = await cdp.eval(`(async () => {
      const sel = document.getElementById('model');
      const btn = document.getElementById('model-refresh');
      const tag = sel.tagName;
      const hasOption = !![...sel.options].find(o => o.value === 'mock-model');
      btn.click();
      for (let i = 0; i < 60; i++) {
        const t = document.getElementById('model-note')?.innerText || '';
        if (/已读取|读不到/.test(t)) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return {
        tag, hasOption,
        note: document.getElementById('model-note')?.innerText || '',
        options: [...sel.options].map(o => o.value)
      };
    })()`);
    assert(modelInfo.tag === 'SELECT', '模型是下拉列表，不是文本框', modelInfo.tag);
    assert(modelInfo.hasOption, '模型下拉列表有当前模型', JSON.stringify(modelInfo.options));
    assert(/读取.*可用模型/.test(modelInfo.note), '能从 /models 读取模型列表', modelInfo.note);
    const store = await cdp.eval(`(() => {
      const c = document.getElementById('remember-key');
      const before = document.getElementById('key-store-state')?.innerText || '';
      c.checked = true;
      c.dispatchEvent(new Event('change'));
      const after = document.getElementById('key-store-state')?.innerText || '';
      return { before, after };
    })()`);
    assert(/本次标签页/.test(store.before), '未勾选时提示只保存在本次标签页', store.before);
    assert(/长期保存/.test(store.after), '勾选后提示长期保存在浏览器', store.after);
    // 恢复成不长期保存，免得后面的「没配 Key」场景读到这个测试 Key
    await cdp.eval(`(() => {
      const c = document.getElementById('remember-key');
      c.checked = false;
      c.dispatchEvent(new Event('change'));
    })()`);
    const settingsShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-settings.png', Buffer.from(settingsShot.data, 'base64'));
    const urlField = await cdp.eval(`(() => {
      const sel = document.getElementById('provider');
      const adv = document.getElementById('base-url-advanced');
      const before = { open: !!adv.open };
      const old = sel.value;
      sel.value = 'openai';
      sel.dispatchEvent(new Event('change'));
      const knownHidden = !adv.open;
      return { before, knownHidden, openAfterSwitch: !!adv.open };
    })()`);
    assert(urlField.before.open, '自定义接口时才展开地址', JSON.stringify(urlField));
    assert(urlField.knownHidden, '内置服务商默认不展开接口地址', JSON.stringify(urlField));
    const knownShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-settings-known.png', Buffer.from(knownShot.data, 'base64'));
    await cdp.eval(`(() => {
      const sel = document.getElementById('provider');
      sel.value = 'custom';
      sel.dispatchEvent(new Event('change'));
    })()`);
    const closed = await cdp.eval(`(() => {
      const d = document.getElementById('settings');
      d?.querySelector('[data-close]')?.click();
      return !d?.open;
    })()`);
    assert(closed, '设置弹窗能关闭');
    const newChat = await cdp.eval(`(() => {
      document.getElementById('new-chat')?.click();
      return {
        msgs: document.querySelectorAll('#chat .msg').length,
        empty: !document.getElementById('empty-state')?.hidden,
      };
    })()`);
    assert(newChat.msgs === 0 && newChat.empty, '「新对话」清空消息并回到空状态', JSON.stringify(newChat));
    const emptyShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-empty.png', Buffer.from(emptyShot.data, 'base64'));
    cdp.close();
  }

  console.log('2. GPT-6 推理模型：自动去掉 temperature、改用 max_completion_tokens');
  {
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=openai-mock&q=${encodeURIComponent('被网暴了第一步做什么？')}`);
    const s = await waitPage(cdp);
    assert(/本地 mock 回答/.test(s.text), '回答渲染出来了', s.text.slice(0, 80));
    const p = await cdp.eval('window.__ASK_LAST_PAYLOAD__ || null');
    assert(p && p.model === 'gpt-6.1-sol', '请求用的是 GPT-6.1 Sol', p && p.model);
    assert(p && p.temperature === undefined && p.max_tokens === undefined, '没有带 temperature / max_tokens', JSON.stringify({ temperature: p && p.temperature, max_tokens: p && p.max_tokens }));
    assert(p && Number(p.max_completion_tokens) >= 1000, '用的是 max_completion_tokens', p && p.max_completion_tokens);
    const testOk = await cdp.eval(`(async () => {
      document.getElementById('test').click();
      for (let i = 0; i < 80; i++) {
        const t = document.getElementById('test-result')?.innerText || '';
        if (/连接成功|连接失败/.test(t)) return t;
        await new Promise(r => setTimeout(r, 100));
      }
      return document.getElementById('test-result')?.innerText || '';
    })()`);
    assert(/连接成功/.test(testOk), '「测试连接」对 GPT-6 也通过', testOk);
    cdp.close();
  }

  console.log('3. 模型不认 temperature / max_tokens 时自动换参数重试');
  {
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=compat-mock&q=${encodeURIComponent('被网暴了第一步做什么？')}`);
    const s = await waitPage(cdp);
    assert(/本地 mock 回答/.test(s.text), '换参数后重试成功', s.text.slice(0, 80));
    const p = await cdp.eval('window.__ASK_LAST_PAYLOAD__ || null');
    assert(p && p.temperature === undefined && !('max_tokens' in p) && Number(p.max_completion_tokens) > 0, '重试请求已去掉温度和 max_tokens', JSON.stringify(p && { temperature: p.temperature, max_tokens: p.max_tokens, max_completion_tokens: p.max_completion_tokens }));
    cdp.close();
  }

  console.log('4. 模型没给追问时，宽泛问题有通用兜底');
  {
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=mock&q=${encodeURIComponent('替朋友担保，签不签？不生成追问')}`);
    await waitPage(cdp);
    const info = await cdp.eval(`(() => {
      const w = document.querySelector('.msg.bot .clarify');
      return w ? { ok: true, qs: w.querySelectorAll('.clarify-q').length } : { ok: false };
    })()`);
    assert(info.ok && info.qs >= 2, '通用追问兜底渲染出来了（' + (info.qs || 0) + ' 题）');
    cdp.close();
  }

  console.log('5. 模型编了一个不存在的条号');
  {
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=mock&q=${encodeURIComponent('测试坏引用：被网暴了第一步做什么？')}`);
    const s = await waitPage(cdp);
    assert(s.bad >= 1, `标红 ${s.bad} 处`, s.summary);
    assert(/不存在/.test(s.summary), '核对结果里明确说书里没有', s.summary);
    cdp.close();
  }

  console.log('6. API Key 错了时的报错');
  {
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=bad&q=${encodeURIComponent('被网暴了第一步做什么？')}`);
    const s = await waitPage(cdp);
    assert(s.notes.some(n => /API Key 不对|没生成成功/.test(n)), '给出人话错误提示', JSON.stringify(s.notes));
    assert(/看服务商返回的原始错误/.test(s.notes.join(' ')), '原始错误折叠在下面');
    const detail = await cdp.eval("document.querySelector('.msg.bot .error-box details pre')?.textContent || ''");
    assert(/HTTP 401/.test(detail) && /invalid api key/.test(detail), '原始错误里有状态码和响应', detail.slice(0, 120));
    cdp.close();
  }

  console.log('7. 书里没有当地数据的迁居问题');
  {
    const q = '夫妻都在北京互联网大厂工作，都超过 35 岁，想带两个孩子（5 岁和不到 1 岁）移民到海南澄迈老城镇，教育、气候、消费都不错，合适吗？';
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=partial&q=${encodeURIComponent(q)}`);
    await waitPage(cdp);
    await clickDirect(cdp, '部分覆盖的迁居问题默认先问，且能直接回答');
    const s = await waitPage(cdp);
    assert(/书里没有澄迈/.test(s.text), '先说清楚书里没有当地数据', s.text.slice(0, 100));
    assert(/这件事要分几笔算|收入与职业/.test(s.text), '拆成几笔账而不是硬列条目');
    assert(/换城市工作时/.test(s.text) && /跨省异地就医/.test(s.text), '只列真正相关的书内条目');
    assert(/正文引用/.test(s.sourcesText || ''), '来源分成正文引用和其他检索');
    assert(/本书只覆盖其中一部分/.test(s.scopeText || ''), '页面显示了确定性的覆盖提示', s.scopeText);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-partial.png', Buffer.from(shot.data, 'base64'));
    cdp.close();
  }

  console.log('8. 没配 Key 的检索模式');
  {
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=retrieve&q=${encodeURIComponent('孩子发烧要去医院吗？')}`);
    const s = await waitPage(cdp);
    assert(s.sources >= 5, `列出检索条目（${s.sources} 张卡）`);
    assert(s.notes.some(n => /没配置 API Key/.test(n)), '提示没有配置 Key', JSON.stringify(s.notes));
    assert(s.cites === 0, '检索模式不生成引用');
    cdp.close();
  }

  console.log('9. 流式回答时显示思考过程，不闪原始 Markdown');
  {
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=reasoning&q=${encodeURIComponent('被网暴了第一步做什么？')}`);
    let live = null;
    for (let i = 0; i < 80; i++) {
      live = await cdp.eval(`(() => {
        const p = document.querySelector('.msg.bot .process');
        const r = p?.querySelector('.process-reasoning');
        return p ? {
          open: p.open,
          summary: p.querySelector('.process-summary')?.innerText || '',
          reasoning: r && !r.hidden ? r.querySelector('pre')?.innerText || '' : '',
          answer: document.querySelector('.msg.bot .answer')?.innerText || ''
        } : null;
      })()`);
      if (live && live.open && live.reasoning) break;
      await timeout(100);
    }
    assert(live && live.open, '生成中过程面板默认展开', JSON.stringify(live));
    assert(live && /先复述用户的问题/.test(live.reasoning), '服务商返回的 reasoning_content 显示在思考过程里', live && live.reasoning);
    assert(live && !/\*\*|^\|/m.test(live.answer), '流式时回答区不闪原始 Markdown', live && live.answer.slice(0, 120));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-process.png', Buffer.from(shot.data, 'base64'));
    const done = await waitPage(cdp);
    assert(/本地 mock 回答/.test(done.text), '思考过程结束后正常渲染回答', done.text.slice(0, 60));
    const closed = await cdp.eval(`(() => {
      const p = document.querySelector('.msg.bot .process');
      return p ? { open: p.open, summary: p.querySelector('.process-summary')?.innerText || '' } : null;
    })()`);
    assert(closed && !closed.open && /已处理/.test(closed.summary), '结束后过程面板收起并显示耗时', JSON.stringify(closed));
    cdp.close();
  }

  console.log('10. 对话记录保存到浏览器缓存');
  {
    // 前面的场景都在同一个浏览器 profile 里问过问题，这里再问一轮，确认最新一条排在最前
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=mock&q=${encodeURIComponent('替朋友担保签不签？')}`);
    await waitPage(cdp);
    await clickDirect(cdp, '历史场景：宽泛问题默认先问');
    const stored = await cdp.eval(`(() => {
      const raw = localStorage.getItem('hltb.ask.history');
      if (!raw) return null;
      const list = JSON.parse(raw);
      const turn = ((list[0] || {}).turns || [])[0] || {};
      return { n: list.length, title: turn.display || turn.q || '' };
    })()`);
    assert(stored && stored.n === 5, '回答后写进浏览器缓存，最多留最近 5 个', JSON.stringify(stored));
    assert(stored && /担保/.test(stored.title), '最新一轮排在最前面', stored && stored.title);

    // 新开一个页面（同一个浏览器、不带 q）：空状态出现「最近问过」，点开就能恢复整段对话
    const { cdp: cdp2 } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=mock`);
    await waitReady(cdp2);
    const opened = await cdp2.eval(`(() => ({
      recent: document.querySelectorAll('#recent-list .hist-item').length,
      hidden: !!document.getElementById('recent-convs')?.hidden
    }))()`);
    assert(opened.recent === stored.n && !opened.hidden, '空状态列出最近对话', JSON.stringify(opened));
    const restored = await cdp2.eval(`(async () => {
      document.querySelector('#recent-list .hist-item')?.click();
      await new Promise(r => setTimeout(r, 400));
      return {
        users: document.querySelectorAll('#chat .msg.user').length,
        bots: document.querySelectorAll('#chat .msg.bot').length,
        text: document.querySelector('#chat .msg.bot .answer')?.innerText || '',
        sources: document.querySelectorAll('#chat .msg.bot .src-card').length,
        basis: document.querySelectorAll('#chat .msg.bot .basis-item').length,
        summary: document.querySelector('#chat .msg.bot .cite-summary')?.innerText || '',
        emptyHidden: !!document.getElementById('empty-state')?.hidden
      };
    })()`);
    assert(restored.users >= 1 && restored.bots >= 1 && restored.emptyHidden, '点开最近对话能恢复整段对话', JSON.stringify({ users: restored.users, bots: restored.bots }));
    assert(/本地 mock 回答/.test(restored.text), '恢复的是原来的回答', restored.text.slice(0, 80));
    assert(restored.sources >= 5, `恢复后依据卡也还在（${restored.sources} 张）`);
    assert(restored.basis >= 1, `恢复后依据速览也还在（${restored.basis} 条）`);
    assert(/核对结果/.test(restored.summary), '恢复后引用核对也在', restored.summary);
    const shot = await cdp2.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-history.png', Buffer.from(shot.data, 'base64'));

    const dialog = await cdp2.eval(`(() => {
      document.getElementById('history-btn')?.click();
      return {
        open: !!document.getElementById('history')?.open,
        rows: document.querySelectorAll('#history-list .hist-row').length,
        active: document.querySelectorAll('#history-list .hist-row.active').length
      };
    })()`);
    assert(dialog.open && dialog.rows === stored.n, '「历史」弹窗列出同样多的对话', JSON.stringify(dialog));
    assert(dialog.active === 1, '当前打开的对话标了「当前对话」');
    await timeout(300);
    const dialogShot = await cdp2.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-history-dialog.png', Buffer.from(dialogShot.data, 'base64'));
    const afterNew = await cdp2.eval(`(() => {
      document.getElementById('history')?.querySelector('[data-close]')?.click();
      document.getElementById('new-chat')?.click();
      return {
        msgs: document.querySelectorAll('#chat .msg').length,
        empty: !document.getElementById('empty-state')?.hidden,
        recent: document.querySelectorAll('#recent-list .hist-item').length
      };
    })()`);
    assert(afterNew.msgs === 0 && afterNew.empty, '「新对话」清空当前消息并回到空状态', JSON.stringify(afterNew));
    assert(afterNew.recent === stored.n, '「新对话」不删历史记录', JSON.stringify(afterNew));
    const afterDelete = await cdp2.eval(`(() => {
      document.getElementById('history-btn')?.click();
      document.querySelector('#history-list .hist-row .hist-x')?.click();
      return {
        rows: document.querySelectorAll('#history-list .hist-row').length,
        stored: JSON.parse(localStorage.getItem('hltb.ask.history') || '[]').length
      };
    })()`);
    assert(afterDelete.rows === stored.n - 1 && afterDelete.stored === stored.n - 1, '「删除」能删掉一个对话', JSON.stringify(afterDelete));
    const cleared = await cdp2.eval(`(() => {
      const btn = document.getElementById('history-clear');
      btn.click();
      const armed = btn.textContent;
      btn.click();
      return {
        armed,
        stored: JSON.parse(localStorage.getItem('hltb.ask.history') || '[]').length,
        rows: document.querySelectorAll('#history-list .hist-row').length,
        empty: !document.getElementById('history-empty')?.hidden
      };
    })()`);
    assert(cleared.armed === '再点一次清空', '「清空全部」要点第二次才执行', cleared.armed);
    assert(cleared.stored === 0 && cleared.rows === 0 && cleared.empty, '清空后历史和列表都空了', JSON.stringify(cleared));
    await cdp2.send('Page.reload');
    await waitReady(cdp2);
    const afterReload = await cdp2.eval(`(() => ({
      recent: document.querySelectorAll('#recent-list .hist-item').length,
      hidden: !!document.getElementById('recent-convs')?.hidden
    }))()`);
    assert(afterReload.recent === 0 && afterReload.hidden, '清空后刷新不再出现最近对话', JSON.stringify(afterReload));
    const emptyDialog = await cdp2.eval(`(() => {
      document.getElementById('history-btn')?.click();
      const d = document.getElementById('history');
      const note = document.getElementById('history-empty');
      const r = { open: !!d?.open, rows: document.querySelectorAll('#history-list .hist-row').length, emptyNote: !!note && !note.hidden };
      d?.close();
      return r;
    })()`);
    assert(emptyDialog.open && emptyDialog.rows === 0 && emptyDialog.emptyNote, '没有历史时弹窗给出说明', JSON.stringify(emptyDialog));
    cdp.close();
    cdp2.close();
  }

  console.log('11. 先问后答接决策打分板');
  {
    const q = '每天通勤两小时值不值？';
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=mock&q=${encodeURIComponent(q)}`);
    await waitPage(cdp);
    const picked = await cdp.eval(`(() => {
      const card = document.querySelector('.msg.bot .clarify-first');
      if (!card) return false;
      card.querySelectorAll('.clarify-q').forEach(q => q.querySelector('.chip')?.click());
      const b = [...card.querySelectorAll('button')].find(x => /按这些情况回答/.test(x.textContent || ''));
      if (!b || b.disabled) return false;
      b.click();
      return true;
    })()`);
    assert(picked, '宽泛问题先出情况选项');
    let board = null;
    for (let i = 0; i < 100; i++) {
      board = await cdp.eval(`(() => {
        const b = document.querySelector('.msg.bot .decision-board');
        return b ? { exists: true, options: b.querySelectorAll('.decision-opt').length, supplement: document.querySelector('.msg.bot .supplement-note:not([hidden])')?.innerText || '' } : null;
      })()`);
      if (board && board.exists) break;
      await timeout(100);
    }
    assert(board && board.exists && board.options >= 2, '补充情况后进入决策板', JSON.stringify(board));
    assert(/补充情况/.test(board.supplement), '决策板保留了补充情况摘要', board.supplement);
    cdp.close();
  }

  console.log('12. 决策打分板：四态、重要性、实时排名');
  {
    const q = '每天通勤两小时值不值？';
    const { cdp } = await newPage(`http://127.0.0.1:${MOCK_PORT}/ask.html?dev=decision&q=${encodeURIComponent(q)}`);
    let board = null;
    for (let i = 0; i < 120; i++) {
      board = await cdp.eval(`(() => {
        const b = document.querySelector('.msg.bot .decision-board');
        return {
          exists: !!b,
          options: b ? b.querySelectorAll('.decision-opt').length : 0,
          criteria: b ? b.querySelectorAll('.decision-matrix tbody tr').length : 0,
          stateBtns: b ? b.querySelectorAll('.decision-state button').length : 0,
          impBtns: b ? b.querySelectorAll('.decision-imp button').length : 0,
          status: b ? b.querySelector('.decision-status')?.innerText || '' : '',
          meta: b ? b.querySelector('.decision-meta')?.innerText || '' : '',
          unknown: b ? b.querySelector('.decision-flips')?.innerText || '' : '',
          cards: b ? b.querySelectorAll('.decision-opt .dyn').length : 0,
        };
      })()`);
      if (board && board.exists) break;
      await timeout(100);
    }
    assert(board && board.exists, '宽泛决策会打开决策板');
    assert(board.options >= 2 && board.criteria >= 3, '决策板有 2 个以上选项和 3 个以上因素', JSON.stringify(board));
    assert(board.stateBtns === board.options * board.criteria * 4, '每个选项×因素都有四态按钮', JSON.stringify(board));
    assert(board.impBtns === board.criteria * 3, '每个因素有三档重要性', JSON.stringify(board));
    assert(/当前推荐|两可|信息不足/.test(board.status), '决策板给出可读的初步结论', board.status);
    assert(/待补/.test(board.unknown), '不知道的因素标成待补', board.unknown);
    const fixed = await cdp.eval(`(() => {
      const rows = [...document.querySelectorAll('.decision-matrix tbody tr')];
      const row = rows.find(r => r.innerText.includes('住房成本'));
      if (!row) return { ok: false };
      const cells = row.querySelectorAll('td');
      const btn = cells[2]?.querySelector('button[data-state="cost"]');
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true, meta: document.querySelector('.decision-meta')?.innerText || '', unknown: document.querySelector('.decision-flips')?.innerText || '' };
    })()`);
    assert(fixed.ok && /待补 0 项/.test(fixed.meta), '补上不知道的项后重新按已知因素计算', JSON.stringify(fixed));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1800, deviceScaleFactor: 1, mobile: false });
    await cdp.eval("document.querySelector('.decide-board')?.scrollIntoView({ block: 'start' }); document.querySelector('.decision-board')?.scrollIntoView({ block: 'start' })");
    await timeout(250);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/ask-decision.png', Buffer.from(shot.data, 'base64'));
    const finalized = await cdp.eval(`(() => {
      const b = [...document.querySelectorAll('.decision-actions button')].find(x => /最终建议/.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    })()`);
    assert(finalized, '决策板有「按这个偏好给最终建议」按钮');
    const done = await waitPage(cdp);
    assert(/本地 mock 回答/.test(done.text), '按偏好生成最终回答', done.text.slice(0, 80));
    const summary = await cdp.eval("document.querySelector('.msg.bot .decision-summary')?.innerText || ''");
    assert(/决策板/.test(summary), '最终回答上方保留决策板摘要', summary);
    cdp.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${failed.length ? '✗ 冒烟测试有失败项' : '✓ 冒烟测试全部通过'}（截图 /tmp/ask-smoke.png）`);
  if (failed.length) process.exitCode = 1;
}

run().catch(err => {
  console.error('冒烟测试出错：', err && err.stack || err);
  process.exitCode = 1;
}).finally(async () => {
  try { if (chrome) chrome.kill('SIGKILL'); } catch (e) {}
  try { if (mock) mock.kill('SIGKILL'); } catch (e) {}
  await timeout(300);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
});
