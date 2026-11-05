// 服务商/模型目录的单测：确保「唯一来源」文件结构完整，旧模型迁移目标存在，
// 不在兜底列表里放已知下线的旧名字。
//
//   node tools/ask/check-catalog.mjs
import { PROVIDERS, MODEL_OPTIONS, RETIRED_MODELS, CHECKED_AT, migrateModel, modelsEndpoint, isChatModelId, isCodexModel, isCodexModelListProvider } from '../../ask/providers.js';

let fail = 0;
function ok(cond, label, extra) {
  if (!cond) { fail++; console.log('✗ ' + label + (extra ? '：' + extra : '')); }
  else console.log('✓ ' + label);
}

ok(/^\d{4}-\d{2}-\d{2}$/.test(CHECKED_AT), `目录有核对日期（${CHECKED_AT}）`);
ok(new Set(PROVIDERS.map(p => p.id)).size === PROVIDERS.length, '服务商 id 不重复');

for (const p of PROVIDERS) {
  ok(!!p.label && (p.id === 'custom' || !!p.baseUrl), `${p.id} 有名称和接口地址`);
  ok(!!p.models && p.models.length > 0, `${p.id} 有模型列表`);
  ok(p.id === 'custom' || !!p.models.find(m => m.id === p.model), `${p.id} 默认模型在列表里（${p.model}）`, JSON.stringify(p.models));
  const ids = p.models.map(m => m.id);
  ok(new Set(ids).size === ids.length, `${p.id} 模型 id 不重复`);
  if (p.id !== 'custom') ok(!!p.keyUrl && !!p.source, `${p.id} 有 Key 页面和官方来源`);
}

// 旧配置迁移：每个旧 ID 都要能迁到当前列表里的模型
for (const [provider, map] of Object.entries(RETIRED_MODELS)) {
  const p = PROVIDERS.find(x => x.id === provider);
  const ids = new Set((p && p.models || []).map(m => m.id));
  for (const [oldId, newId] of Object.entries(map)) {
    const got = migrateModel(provider, oldId);
    ok(got === newId && ids.has(got), `${provider}: ${oldId} → ${got}`, JSON.stringify([...ids]));
  }
}

// 官方旧模型不应再出现在当前兜底列表里
const STALE = ['deepseek-chat', 'deepseek-reasoner', 'moonshot-v1-32k', 'gpt-5', 'gpt-4o', 'o3', 'o4-mini'];
for (const id of STALE) {
  ok(!Object.values(MODEL_OPTIONS).flat().some(m => m.id === id), `旧模型不占兜底列表：${id}`);
}

ok(modelsEndpoint('https://api.openai.com/v1') === 'https://api.openai.com/v1/models', 'modelsEndpoint 拼 /models');
ok(!isChatModelId('text-embedding-3-small') && isChatModelId('gpt-6.1-sol'), '过滤 embedding 等非聊天模型');
ok(isCodexModelListProvider('openai') && !isCodexModelListProvider('deepseek'), '只有 OpenAI 按 Codex 模型列表过滤');
ok(isCodexModel('openai', 'gpt-6.1-sol') && isCodexModel('openai', 'gpt-5.6-sol'), 'Codex 当前列表中的 OpenAI 模型通过');
ok(!isCodexModel('openai', 'gpt-4o') && !isCodexModel('openai', 'gpt-5'), '弃用的 OpenAI 模型不再进入下拉');
ok(isCodexModel('deepseek', 'deepseek-flash'), '其他服务商不套 Codex 列表');

if (fail) { console.error(`\n目录检查失败 ${fail} 条`); process.exitCode = 1; }
else console.log('\n目录检查通过');
