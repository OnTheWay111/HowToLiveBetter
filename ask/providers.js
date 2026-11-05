// 服务商和模型名的唯一来源。设置页的下拉列表、默认值、旧模型迁移都读这里，
// 不再散落在 agent.js 和 ask.html 里。
//
// 这里列的是「离线兜底」和默认值；用户点设置里的「刷新」会再读服务商的
// /models 接口，把账号当前可用的模型合并进来。官方页面改版时，先改这个文件；
// 列表的官方出处写在每个服务商的 source 字段里。
//
// 最近核对：2026-11-05
// - OpenAI：https://developers.openai.com/api/docs/models
// - DeepSeek：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// - Kimi：https://platform.kimi.com/docs/models
// - OpenRouter：https://openrouter.ai/docs/guides/overview/models

export const CHECKED_AT = '2026-11-05';

export const PROVIDERS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
    models: [
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6.1-sol',
    keyUrl: 'https://platform.openai.com/api-keys',
    source: 'https://developers.openai.com/api/docs/models',
    codexSource: 'https://learn.chatgpt.com/docs/models',
    // Codex 当前模型选择器里的推荐集合。OpenAI 的 /models 会返回账号下全部
    // API 模型（含弃用快照、search/live 等），这里用它把下拉列表收窄到
    // Codex 实际提供的那组。
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    ],
  },
  {
    id: 'moonshot',
    label: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro',
    keyUrl: 'https://platform.kimi.com/console/api-keys',
    source: 'https://platform.kimi.com/docs/models',
    models: [
      { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro' },
      { id: 'kimi-k3.1-pro-highspeed', label: 'Kimi K3.1 Pro 高速版' },
      { id: 'kimi-k3', label: 'Kimi K3' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/auto',
    keyUrl: 'https://openrouter.ai/keys',
    source: 'https://openrouter.ai/docs/guides/overview/models',
    models: [
      { id: 'openrouter/auto', label: 'OpenRouter Auto（自动路由）' },
    ],
  },
  {
    id: 'custom',
    label: '自定义 OpenAI 兼容接口',
    baseUrl: '',
    model: '',
    keyUrl: '',
    source: '',
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
      { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro' },
    ],
  },
];

export const MODEL_OPTIONS = Object.fromEntries(PROVIDERS.map(p => [p.id, p.models]));

/** OpenAI 的模型按 Codex 当前选择器收窄；其他服务商不过滤。 */
export function isCodexModelListProvider(providerId) {
  return providerId === 'openai';
}
export function isCodexModel(providerId, modelId) {
  if (!isCodexModelListProvider(providerId)) return true;
  return (MODEL_OPTIONS.openai || []).some(m => m.id === modelId);
}

// 旧配置里的模型 ID：官方已弃用/下线的，打开设置时迁到当前模型，不再把旧 ID
// 当成「当前模型」显示在下拉里。
export const RETIRED_MODELS = {
  deepseek: {
    'deepseek-chat': 'deepseek-flash',
    'deepseek-reasoner': 'deepseek-flash',
    'deepseek-v4-flash': 'deepseek-flash',
    'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  },
  openai: {
    'gpt-4o': 'gpt-6.1-sol',
    'gpt-4o-mini': 'gpt-6.1-sol',
    'gpt-4.1': 'gpt-6.1-sol',
    'gpt-4.1-mini': 'gpt-6.1-sol',
    'gpt-4.1-nano': 'gpt-6.1-sol',
    'gpt-5': 'gpt-6.1-sol',
    'gpt-5-mini': 'gpt-6.1-sol',
    'gpt-5-nano': 'gpt-6.1-sol',
    'gpt-5-pro': 'gpt-6.1-sol',
    'gpt-5.1': 'gpt-6.1-sol',
    'gpt-5.2': 'gpt-6.1-sol',
    'gpt-5.2-pro': 'gpt-6.1-sol',
    'gpt-5.4': 'gpt-6.1-sol',
    'gpt-5.4-pro': 'gpt-6.1-sol',
    'gpt-5.4-mini': 'gpt-6.1-sol',
    'gpt-5.4-nano': 'gpt-6.1-sol',
    'gpt-5.5': 'gpt-6.1-sol',
    'gpt-5.5-pro': 'gpt-6.1-sol',
    'o3': 'gpt-6.1-sol',
    'o3-mini': 'gpt-6.1-sol',
    'o3-pro': 'gpt-6.1-sol',
    'o4-mini': 'gpt-6.1-sol',
  },
  moonshot: {
    'moonshot-v1-8k': 'kimi-k3.1-pro',
    'moonshot-v1-32k': 'kimi-k3.1-pro',
    'moonshot-v1-128k': 'kimi-k3.1-pro',
    'moonshot-v1-auto': 'kimi-k3.1-pro',
    'kimi-latest': 'kimi-k3.1-pro',
    'kimi-k2.5': 'kimi-k3.1-pro',
    'kimi-k2-0905-preview': 'kimi-k3.1-pro',
    'kimi-k2-thinking': 'kimi-k3.1-pro',
  },
  custom: {},
};

export function providerById(id) {
  return PROVIDERS.find(p => p.id === id) || PROVIDERS[0];
}

/** 把旧模型 ID 迁到当前官方模型；不是旧 ID 就原样返回。 */
export function migrateModel(providerId, model) {
  const m = String(model || '').trim();
  if (!m) return '';
  const retired = RETIRED_MODELS[providerId] || {};
  return retired[m] || m;
}

/** 从 /models 返回里剔掉不是聊天模型的项（embedding、语音、图像、审核等）。 */
export function isChatModelId(id) {
  const s = String(id || '');
  return !/(embedding|tts|whisper|transcribe|realtime|audio|image|dall-e|moderation|sora)/i.test(s);
}

/** OpenAI 兼容的模型列表地址。 */
export function modelsEndpoint(baseUrl) {
  const u = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/\/chat\/completions$/i.test(u)) return u.replace(/\/chat\/completions$/i, '/models');
  return u + '/models';
}
