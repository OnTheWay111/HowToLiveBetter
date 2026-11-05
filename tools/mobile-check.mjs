// 移动端适配检查：无头 Chrome 在常见手机、全面屏、折叠屏、平板和横屏尺寸下打开
// index.html / ask.html / selfcheck.html，检查横向溢出、页头被挤爆、输入框被顶出屏幕、
// 弹窗和侧栏是否还在可视区内，并截图到 /tmp/mobile-check-*.png。
//
//   node tools/mobile-check.mjs               # Node 22+ 直接跑
//   node --experimental-websocket tools/mobile-check.mjs   # Node 20
//
// Chrome 不在默认位置就设 CHROME=/path/to/Chrome。页面直接从本地静态服务读
// README.md 和 book/，不需要 API Key，也不会发真实请求。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER_PORT = 8799;
const CDP_PORT = 9445;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const SHOT_DIR = '/tmp';
const VIEWPORTS = [
  { name: '280x653-fold-cover', w: 280, h: 653, mobile: true },
  { name: '320x568-small', w: 320, h: 568, mobile: true },
  { name: '360x640', w: 360, h: 640, mobile: true },
  { name: '390x844-notch', w: 390, h: 844, mobile: true },
  { name: '412x915-android', w: 412, h: 915, mobile: true },
  { name: '717x512-fold-inner', w: 717, h: 512, mobile: true },
  { name: '844x390-landscape', w: 844, h: 390, mobile: true },
  { name: '1024x768-tablet', w: 1024, h: 768, mobile: false },
];
const EXTRA_VIEWPORTS = VIEWPORTS.filter(v => ['280x653-fold-cover', '320x568-small', '390x844-notch', '844x390-landscape'].includes(v.name));
const timeout = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const assert = (ok, label, extra) => {
  results.push({ ok, label });
  if (!ok) console.error('  ✗ ' + label + (extra ? '：' + extra : ''));
};

if (!existsSync(CHROME)) {
  console.error('找不到 Chrome：' + CHROME + '\n用 CHROME=/path/to/Chrome 指定。');
  process.exit(2);
}
if (typeof WebSocket === 'undefined') {
  console.error('这个脚本要用全局 WebSocket。Node 20 请加 --experimental-websocket，Node 22 及以上直接跑。');
  process.exit(2);
}

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  async open() {
    await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }); });
    this.ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message || JSON.stringify(m.error))) : p.res(m.result);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((res, rej) => { const id = ++this.id; this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面脚本报错');
    return r && r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function waitHttp(url, tries = 120) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (e) {} await timeout(200); }
  throw new Error('等不到 ' + url);
}
async function openPage() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  return { cdp, target };
}
async function closePage(page) {
  page.cdp.close();
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${page.target.id}`); } catch (e) {}
}
async function setViewport(cdp, v) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.mobile,
    screenWidth: v.w, screenHeight: v.h,
    screenOrientation: { type: v.w > v.h ? 'landscapePrimary' : 'portraitPrimary', angle: v.w > v.h ? 90 : 0 },
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: v.mobile, maxTouchPoints: v.mobile ? 5 : 0 }).catch(() => {});
}
async function waitFor(cdp, expr, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await cdp.eval(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return; } catch (e) {}
    await timeout(180);
  }
  throw new Error('等不到页面状态：' + expr);
}

// 元素出了视口、又没有可横向滚动的祖先，才算真溢出；侧栏收起时本来就在屏外，跳过。
const METRICS = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const skip = new Set(['SCRIPT','STYLE','LINK','META','NOSCRIPT','SVG','PATH','CIRCLE','RECT']);
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    if (skip.has(el.tagName)) continue;
    if (el.closest('.sidebar') && !document.querySelector('.sidebar.open')) continue;
    if (el.closest('#doc-mask[hidden]')) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > vw + 1 || r.left < -1) {
      let p = el.parentElement, scrollable = false;
      while (p && p !== document.body) {
        const ps = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(ps.overflowX) || /(auto|scroll|hidden)/.test(ps.overflow)) { scrollable = true; break; }
        p = p.parentElement;
      }
      if (!scrollable) offenders.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 50), text: (el.textContent || '').trim().slice(0, 30) });
    }
  }
  const nav = document.querySelector('.nav');
  const composer = document.querySelector('.composer');
  const navR = nav && nav.getBoundingClientRect();
  const cR = composer && composer.getBoundingClientRect();
  return {
    vw, vh,
    scrollW: document.documentElement.scrollWidth,
    horizOverflow: document.documentElement.scrollWidth > vw + 1,
    offenders: offenders.slice(0, 6),
    nav: navR ? { sw: nav.scrollWidth, cw: nav.clientWidth, h: Math.round(navR.height) } : null,
    composer: cR ? { bottom: Math.round(cR.bottom), h: Math.round(cR.height) } : null,
  };
})()`;

async function loadIndex(cdp) { await waitFor(cdp, "document.querySelectorAll('.card').length > 100", 45000); await timeout(300); }
async function loadAsk(cdp) { await waitFor(cdp, 'window.__ASK_READY__', 30000); await timeout(200); }
async function loadSelfcheck(cdp) { await waitFor(cdp, "document.getElementById('ask') && !document.getElementById('ask').hidden", 45000); await timeout(200); }

const STATES = [
  { name: 'index', url: () => BASE + '/index.html', ready: loadIndex, vps: VIEWPORTS },
  { name: 'ask-empty', url: () => BASE + '/ask.html', ready: loadAsk, vps: VIEWPORTS },
  { name: 'ask-answer', url: () => BASE + '/ask.html?dev=mock&q=' + encodeURIComponent('替朋友担保签不签？'), ready: async cdp => {
      await loadAsk(cdp);
      await cdp.eval(`(() => { const card = document.querySelector('.msg.bot .clarify-first'); const b = card && [...card.querySelectorAll('button')].find(x => /直接回答/.test(x.textContent || '')); if (b) b.click(); return true; })()`);
      await waitFor(cdp, 'window.__ASK_DONE__', 35000);
      await timeout(300);
    }, vps: VIEWPORTS },
  { name: 'selfcheck-ask', url: () => BASE + '/selfcheck.html', ready: loadSelfcheck, vps: EXTRA_VIEWPORTS },
  { name: 'selfcheck-out', url: () => BASE + '/selfcheck.html', ready: async cdp => {
      await loadSelfcheck(cdp);
      await cdp.eval(`(() => {
        const ans = { 'p:ageYears': '40', 'p:sex': 'm', 'p:kid': 'n' };
        for (const b of document.querySelectorAll('#qs [data-k]')) { const k = b.dataset.k; if (k && !k.startsWith('p:')) ans[k] = 'y'; }
        localStorage.setItem('selfcheck-v1', JSON.stringify(ans));
        return true;
      })()`);
      await cdp.send('Page.reload');
      await loadSelfcheck(cdp);
      await cdp.eval(`document.getElementById('go')?.click()`);
      await waitFor(cdp, "document.getElementById('out') && !document.getElementById('out').hidden", 15000);
      await timeout(250);
    }, vps: EXTRA_VIEWPORTS },
  { name: 'index-sidebar', url: () => BASE + '/index.html', ready: async cdp => {
      await loadIndex(cdp);
      await cdp.eval(`document.getElementById('menu')?.click()`);
      await waitFor(cdp, "document.getElementById('sidebar')?.classList.contains('open')", 5000);
      await timeout(250);
    }, vps: EXTRA_VIEWPORTS },
  { name: 'index-doc', url: () => BASE + '/index.html', ready: async cdp => {
      await loadIndex(cdp);
      const ok = await cdp.eval(`(() => { const a = document.querySelector('a[href*="github.com/eternity4719/HowToLiveBetter/blob/main/docs/"]'); if (a) { a.click(); return true; } return false; })()`);
      if (!ok) throw new Error('找不到长文入口');
      await waitFor(cdp, "document.getElementById('doc-mask') && !document.getElementById('doc-mask').hidden", 15000);
      await timeout(350);
    }, vps: EXTRA_VIEWPORTS },
  { name: 'ask-settings', url: () => BASE + '/ask.html', ready: async cdp => {
      await loadAsk(cdp);
      await cdp.eval(`document.getElementById('open-settings')?.click()`);
      await waitFor(cdp, "document.getElementById('settings')?.open", 5000);
      await timeout(250);
    }, vps: EXTRA_VIEWPORTS },
];

async function main() {
  if (!CHROME) throw new Error('没有 Chrome');
  const profileDir = mkdtempSync(join(tmpdir(), 'hltb-mobile-'));
  const server = spawn(process.execPath, [join(ROOT, 'tools/ask/mock-server.mjs'), String(SERVER_PORT)], { cwd: ROOT, stdio: 'ignore' });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
  try {
    await waitHttp(`${BASE}/index.html`);
    await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    for (const state of STATES) {
      console.log(`\n${state.name}`);
      for (const v of state.vps) {
        const page = await openPage();
        let m;
        try {
          await page.cdp.send('Page.navigate', { url: 'about:blank' });
          await timeout(100);
          await setViewport(page.cdp, v);
          await page.cdp.send('Page.navigate', { url: state.url() });
          await state.ready(page.cdp);
          await timeout(150);
          m = await page.cdp.eval(METRICS);
          const shot = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          writeFileSync(join(SHOT_DIR, `mobile-check-${state.name}-${v.name}.png`), Buffer.from(shot.data, 'base64'));
        } catch (e) {
          assert(false, `${state.name} ${v.name} 打开失败`, e.message);
          continue;
        } finally {
          await closePage(page);
        }
        assert(!m.horizOverflow, `${state.name} ${v.name} 没有横向溢出`, `scrollWidth ${m.scrollW} > ${m.vw}`);
        assert(m.offenders.length === 0, `${state.name} ${v.name} 没有元素跑出屏幕`, JSON.stringify(m.offenders));
        if (m.nav) assert(m.nav.sw <= m.nav.cw + 1, `${state.name} ${v.name} 页头没有溢出`, JSON.stringify(m.nav));
        if (m.composer) assert(m.composer.bottom <= m.vh + 1, `${state.name} ${v.name} 输入框在屏幕内`, JSON.stringify(m.composer));
        if (!m.horizOverflow && m.offenders.length === 0) console.log(`  ✓ ${v.name}`);
      }
    }
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    try { server.kill('SIGKILL'); } catch (e) {}
    await timeout(300);
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n${failed.length ? '✗ 移动端检查有失败项' : '✓ 移动端检查全部通过'}（截图 /tmp/mobile-check-*.png）`);
  if (failed.length) process.exitCode = 1;
}
main().catch(err => { console.error('移动端检查出错：', err && err.stack || err); process.exitCode = 1; });
