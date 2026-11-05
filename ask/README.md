# 网页版问答（ask.html）

先把书里的条目检索出来，再交给模型整理成回答，每条注明第几节第几条。回答里的条号会逐条校验：书里不存在的标红，不在本次检索里的标黄。

- 线上地址：https://eternity4719.github.io/HowToLiveBetter/ask.html
- 不需要后端，不需要构建步骤，和 `index.html`、`selfcheck.html` 一样是纯静态页。
- 不配置 API Key 也能用：只检索，把最相关的条目列出来。

## 怎么用

1. 打开 `ask.html`，页头点「已配置 / 未配置 Key」或「设置」，选服务商（DeepSeek、OpenAI、Moonshot、OpenRouter 或任意 OpenAI 兼容接口），填 API Key；模型从下拉列表选，不用记模型 ID。接口地址也按服务商自动配好，只有走中转、代理或自建服务时才打开「高级设置」改。设置是弹窗，不再占着对话首屏。
2. 可选：展开「我的情况」，填年龄、性别、人群、预算、时间、毅力、想换回什么。填了会参与筛选和加权。
3. 在底部输入问题，Enter 发送，Shift+Enter 换行。
4. 回答按「结论 / 先做 / 别做 / 书里没写 / 复查点」分块显示。引用写成 `[1][2]`，点编号会展开对应的依据卡；结论下面还有一块「依据速览」，数字和结论直接取原文，点「查看原文」在页内弹窗看整条（说人话、成本、收益、证据、来源、备注）。依据区分成「正文引用」和「其他检索到的条目（没被引用）」。点「在检索页打开原文」会新开标签页，不丢当前对话。
5. 问题太宽泛（「值不值 / 该不该 / 签不签」这类）或书只覆盖一部分时，默认**先问后答**：页面上先出现 2 到 4 个关键情况选项，选完点「按这些情况回答」。不想选或急着看答案，点「直接回答，不用问我」跳过。急症、自杀、书外推荐不先问，直接处理。
6. 问过的对话会留在浏览器里：页头「历史」或空状态里的「最近问过」都能重新打开，最多保留最近 5 个。点「删除」删掉一个；「清空全部」要连点两次才生效。「新对话」只是新开一个，不会删掉旧的。

### 对话记录存在哪

- 问过的对话只存在当前浏览器的 `localStorage`（键名 `hltb.ask.history`），最多保留最近 5 个对话，每个对话最多 40 轮问答。
- 刷新、关掉页面再打开都还在；点页头「历史」或空状态里的「最近问过」就能打开。
- 清理浏览器数据、换设备或换浏览器就没了。页面没有服务器，记录不会同步到别处。
- 记录里存着你的问题和完整回答。问题（连同最近的对话摘要）仍会随请求发给你选的服务商。公共电脑上问完可以点「历史 → 清空全部」。
- 只存问题、回答和用到的条号，不存 API Key。回答失败或中途停止的那一轮不保存。

### Key 存在哪

- 默认只存在当前标签页的 `sessionStorage`，关掉页面就没了。
- 勾「长期保存 Key 到这台浏览器」才写进 `localStorage`；不勾只写 `sessionStorage`，关掉标签页就清掉。公共电脑上不要勾。
- 设置里会直接显示当前是「本次标签页」还是「长期保存」，不用猜。
- Key 只发给你选的服务商；页面没有服务器，也没有任何中转。请求由浏览器直接发出去。
- 问题、检索到的条目摘要和「我的情况」会一起发给你选的服务商，别在里面填身份证号、病历号、手机号这类信息。
- 页面故意不加载统计脚本、第三方字体和广告，减少能读到 Key 的第三方脚本。改这个页面时请保持这一点。

### 支持的接口

预设了几家，也可以选「自定义」填任何 OpenAI 兼容的 `/chat/completions` 地址：

| 服务商 | 接口地址 | 默认模型 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-6.1-sol` |
| Kimi / Moonshot | `https://api.moonshot.cn/v1` | `kimi-k3.1-pro` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openrouter/auto` |

模型名和价格以各家官网为准。模型是下拉列表，不能手填；默认值和旧模型迁移都在 `ask/providers.js`，改模型名单只改这个文件。一次问答的提示词大约 1 万 tokens 上下，模型上下文窗口至少要 16k。

**OpenAI 的 GPT-6 / GPT-5 / o 系列是推理模型**，Chat Completions 下和普通模型有两处参数差别（[官方迁移指南](https://developers.openai.com/api/docs/guides/latest-model)）：reasoning effort 不是 `none` 时不能带 `temperature`、`top_p`；`max_tokens` 已弃用且和推理模型不兼容，要用 `max_completion_tokens`（推理 token 也算在里面）。页面会按模型名自动处理：推理模型不带温度、改用 `max_completion_tokens`；普通模型照旧用 `temperature` + `max_tokens`。如果服务商仍然返回 400，会再按错误信息做一次兼容重试。

遇到「测试连接失败」：

1. 点开「看服务商返回的原始错误」，先看具体是哪个字段、哪个模型。
2. GPT-6.1 Sol 的模型 ID 是 `gpt-6.1-sol`，选 OpenAI 后接口地址自动用 `https://api.openai.com/v1`，不用手填；Chat Completions 是支持的（[模型页](https://developers.openai.com/api/docs/models/gpt-6.1-sol)）。
3. 401 是 Key 的问题，404 多半是模型名，400 多半是参数/模型不配套。国内访问 OpenAI 一般要代理；DeepSeek 不用。服务商如果以后不允许浏览器直连（CORS 变化），可以在「高级设置」里填自己的中转地址，或者换一家。

## 模型列表从哪来

- 唯一来源是 `ask/providers.js`：服务商名、接口地址、Key 页面、默认模型、兜底模型名单、旧模型迁移都在这里面。`ask/agent.js` 只做 re-export，设置页不直接写死模型名。
- 每个服务商带 `source`（官方模型页）和 `CHECKED_AT`（核对日期）；官方列表变了先改这个文件，再跑 `node tools/ask/check-catalog.mjs`。
- 打开设置时，如果已有 Key，会**自动**请求服务商的 `/models`（OpenAI 兼容），把账号当前可用的模型合并进下拉；模型旁边的「刷新」也能手动触发。CORS 被挡或接口不支持时保留 `providers.js` 的兜底列表。
- `/models` 返回里会过滤掉 embedding、TTS、Whisper、图片、Realtime 等非聊天模型。
- 旧配置里的已下线模型 ID 会迁到当前模型：比如 `deepseek-chat` → `deepseek-flash`、`moonshot-v1-*` → `kimi-k3.1-pro`、`gpt-5`/`gpt-4o`/`o3` → `gpt-6.1-sol`。迁移表在 `RETIRED_MODELS`。
- 用户的模型 ID 如果不在列表里（例如自定义接口或刚上线的新模型），会作为「当前」选项保留，不会因为换列表把配置弄丢。
- **OpenAI 额外按 Codex 当前模型列表过滤**：`/models` 返回的是账号下全部 API 模型，包含 `gpt-4o-2024-08-06` 这类历史快照、`chat-latest`、`gpt-5-search-api`、`gpt-live-1` 以及已弃用模型；Codex 的模型选择器只列它认证/推荐的模型。所以 OpenAI 的下拉只会保留 `ask/providers.js` 里的 Codex 集合（当前对齐：GPT-6.1 Sol、GPT-6 Astra、GPT-6.1 Terra、GPT-6 Sol、GPT-6 Luna、GPT-5.6 Sol/Terra/Luna）。其他服务商不套这个列表。
- 注意：Codex 用 Responses API 和它的 agent 工具链；本页是 Chat Completions 的 BYOK 页面。这里对齐的是「模型选择列表」，不是 Codex 的完整运行行为。
- 走中转/代理时，接口地址在「高级设置」里；模型仍然从下拉列表选，必要时先刷新。

官方来源（`providers.js` 里也各有一条）：

- OpenAI 模型页：https://developers.openai.com/api/docs/models
- DeepSeek 模型和价格：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
- Kimi 模型列表：https://platform.kimi.com/docs/models
- OpenRouter 模型列表：https://openrouter.ai/docs/guides/overview/models
- Codex 模型列表：https://learn.chatgpt.com/docs/models

## 为什么没有 GitHub 登录和跨设备同步

这是纯静态 GitHub Pages 页面，没有后端。API Key 只存在浏览器里：

- 勾「长期保存」后写 `localStorage`，同一台电脑、同一个浏览器、同一个站点下下次打开还在；
- 不勾只写 `sessionStorage`，关标签页就清。

GitHub 登录本身解决不了这个问题：OAuth 的 client secret 不能放静态页；用 GitHub 设备流登录后，也没有安全的地方存 API Key。把 Key 写进 Gist 需要用 GitHub token 换存储，token 泄露或第三方脚本读取都会连带暴露 Key，不适合作为默认方案。要做跨设备同步，需要加一个后端（例如 Cloudflare Worker）做加密存储，或者做「导出一份加密配置、另一台设备导入」。当前版本保持 BYOK + 浏览器本地保存。

## 界面结构

- 整页是「聊天优先」的布局：页头只放书名、Key 状态、我的情况、历史、新对话、设置；设置、我的情况和历史都是弹窗，不再把提问输入框挤到首屏下面。左侧书名链回检索页，不再单放一个「回检索页」按钮。
- 窄屏和折叠屏：280px 的外屏起可用，页头压成「← 指南 + Key + 历史 / 新对话 / 设置」；弹窗在 ≤720px 全屏；引用编号的点击热区在手机上放大；软键盘弹起时聊天区跟着可视区缩（`visualViewport`），输入框不会被键盘盖住。检索页和自查页的页头、卡片、长文表格也各有一套窄屏规则。移动端检查跑 `node tools/mobile-check.mjs`。
- 空状态只放说明、示例问题、最近问过的对话和输入框；发出第一条后空状态收起，对话区独立滚动，输入框固定在底部、不覆盖回答。
- 页头「历史」打开最近对话列表；空状态里也有一块「最近问过」。对话在每轮结束时写进 `localStorage`，最多 5 个，开过的那个会标「当前对话」。
- 回答是卡片；`structureAnswer()` 按 h4 分节，`cleanActionItems()` 把「**动作**：说明」拆成标题和正文块，行动项带编号。
- 回答上方有一个 Codex 风格的「处理过程」面板：生成中展开，显示检索条目数、覆盖判断、生成状态和耗时；结束后自动收起成「已处理 X 秒 · N 条依据 · M 处引用」，点「展开」还能看步骤。
- 服务商返回 `reasoning_content`（DeepSeek、Kimi 等）时，会显示在过程面板的「思考过程」里；OpenAI Chat Completions 不返回这段，就只显示步骤。
- 流式生成时回答区只显示「正在组织回答…」，不会闪原始 Markdown；生成完、核对引用后再一次性渲染成卡片。Markdown 表格也会渲染成 table。
- 引用编号、来源分组和「其他检索」折叠由 `linkifyCitations()` / `renderSources()` 负责。
- 结论下面有「依据速览」：`renderBasis()` 按本次引用校验结果，从正文里直接取被引条目的 `说人话`、证据等级和争议标记，不经过模型；最多列 2 条，多于 2 条时提示去看下面的「正文引用」。
- 「依据速览」和依据卡里的「查看原文」都调 `openEntry()`，在页内弹窗展示整条原文（说人话、成本、收益、证据等级、来源、备注），弹窗里再给「在检索页打开原文」链接；按钮是动态生成的，点击统一走 `wireDialogs()` 里的事件委托。
- 宽泛问题默认在回答前展开「先确认几件事」卡；选完按这些情况回答，或直接回答跳过。
- 回答后的补充追问卡仍保留：默认收起成一行摘要，展开后才显示选项；提交后旧卡收起成「已按补充情况重答：…」。

## 交互式追问怎么工作

现在是两层：

1. **回答前**：判定为宽泛决定（`isBroadQuestion()`）或覆盖模式为 `partial` 时，先调一次只生成追问的接口：`CLARIFY_SYSTEM_PROMPT` + `buildClarifyMessages()`，页面用 `fetchClarifyQuestions()` 解析出 2 到 4 个问题，交给 `renderClarifyFirst()` 显示。读者可以选项 + 提交，也可以点「直接回答，不用问我」跳过；两条路都用 `generateInto()` 写回同一条机器人消息，不会重复插一条用户消息。这次回答结束后不再弹第二张追问卡。
2. **回答后**：如果前一步没有先问（模型没生成、接口失败、或题目本身不宽泛），模型仍可在回答末尾藏 `<!-- 追问 {...} -->`，页面用 `extractClarify()` 在结论下面渲染收起式追问卡，作为补救。提交后走 `ask(..., {skipClarify:true})`，不会再触发一次前置引导。

- 追问接口失败不阻塞回答，会直接退回正常回答；急症、自杀、书外推荐不先问。
- 模型没按格式给追问时，宽泛问题会退到 `GENERIC_CLARIFY` 那组通用问题。
- 流式显示时 `streamVisible()` 会提前把追问注释藏掉，不会闪出原始 JSON。
- 改追问格式时，三处一起改：`CLARIFY_SYSTEM_PROMPT` / `buildClarifyMessages()`（前置）、`SYSTEM_PROMPT` 末尾的追问说明（后置补救）、`extractClarify()`；mock 示例和冒烟测试也跟着改。前置提问会多花一次很小的 API 调用，但比先答一遍再重答便宜。

## 决策打分板

宽泛的权衡问题（通勤、搬家、换工作、择校等）在读者选完「先问后答」的情况后，不直接给长答案，而是进入决策打分板：

- 模型只生成 2 到 4 个选项、3 到 6 个因素和初始判断，不生成分数或排名；
- 每个选项×因素只选 **有好处 / 有坏处 / 没有影响 / 不知道**；
- 每个因素标 **很重要 / 一般 / 不太重要**（3/2/1）；
- 某个因素只要有一个选项是「不知道」，整项先不计入排名，显示为待补；不能把不知道当成没有影响；
- 页面用 `ask/decision.js` 的 `scoreDecision()` 实时算净支持、待补项、结论强度，并给出权重变化时的翻转条件；
- 用户点「按这个偏好给最终建议」后，排名和权重作为「决策板结果」注入最终回答；最终回答不能重新算分或引入新因素。

实现位置：

- `ask/decision.js`：四态、三档重要性、未知排除、排名、敏感性；
- `ask/agent.js`：`DECISION_SYSTEM_PROMPT`、`buildDecisionMessages()`、`parseDecisionJson()`；
- `ask.html`：`renderDecisionBoard()`、`updateDecisionResult()`、`finalizeDecision()`；
- `tools/ask/check-decision.mjs`：纯函数单测，CI 里跑。

## 回答怎么写清楚

决策类问题（值不值、该不该、选哪个）不再用「要看情况」当结论：

- 第一行必须是 `### 结论`，下一行写「我的倾向：……」，并写清这个倾向依赖的前提；结论里要带一个来自条目的原文数字或具体事实（书里没有就明说，不许编）；缺数字时用「如果 X 超过 Y，选 A；否则选 B」的规则代替空泛判断。
- 紧接着写「书里怎么说」：挑 1 到 2 条最相关的书内条目，写清结论和至少一个原文数字，可以照抄「说人话」整句，数字和口径照抄「收益」栏；不要只给条号。
- 说明书里缺什么、依赖哪些假设，放到后面的「### 书里没写」小节，只说一次；不要把它塞进结论段。
- 中间只拆 3 到 5 笔账，能算的先用书里的换算和读者的数字算一遍（例如「单程少 30 分钟 = 每周省 5 小时」，读者每天往返 2 小时，就先算每天、每月省多少）；缺数的给核实渠道。
- 只列真正相关的 1 到 3 条书内条目，每条带结论和至少一个原文数字，不要把成本、收益、备注整段复制；问通勤不要写血压、肾病、近视，检索到不等于相关。
- 部分覆盖的回答控制在 1200 字以内，表格最多 4 行；结尾用「### 现在先做」给一个动作，不要用「还差关键信息」收尾。
- 不要用「书里只覆盖一部分」「书里没有直接答案」这类覆盖判断开头或塞进正文；页面会显示覆盖提示，正文只具体说缺哪个数字、哪件事。
- 先问后答时，页面会把读者补充的情况重新带进检索，再生成回答，避免继续用回答前那份不完整的检索结果。

页面还会在结论下面自动渲染「依据速览」：直接取被引条目的 `说人话` 和证据徽章，不经过模型改写；每条都有「查看原文」按钮，在页内弹窗展示整条原文。模型漏掉数字时，这块也能兜底。

## 覆盖判断（确定性，不依赖模型）

回答前先跑 `assessCoverage(question, hits, corpus)`，把问题判成三类：

- `partial`：涉及具体地点/搬迁/当地情况，书里没有当地数据，但有部分通用条目能帮上；
- `none`：具体地点事实、具体商品/机构推荐，书里没有对应信息；
- `auto`：没有超出书范围的信号，交给模型按正常规则判断。

`partial` / `none` 会把一段「系统事前判定」直接注入提示词，锁住回答结构：`partial` 必须先写「书里怎么说」（带原文数字），再拆成几笔账，只列真正相关的 1~3 条；`none` 不许硬套检索结果。页面顶部也会显示对应的提示条。判断规则和单测在 `ask/agent.js` 的 `assessCoverage()` 与 `tools/ask/check-coverage.mjs`，CI 的「问答检索评测」job 会跑；它不调 API。

## 书里没有直接答案时

问题超出书范围时，不应该硬把检索到的条目套成答案。比如：

> 夫妻都在北京互联网大厂工作，都超过 35 岁，想带两个孩子（5 岁和不到 1 岁）移民到海南澄迈老城镇，教育、气候、消费都不错，合适吗？

书里没有澄迈的学校、房价、岗位、气候数据，不能判断“搬过去合不合适”。期望的回答不是列育儿补贴、个税扣除、育儿假，而是：

1. 第一段先说明书里没有当地数据、不能替读者判断；
2. 把问题拆成收入与职业、孩子教育、住房与生活成本、社保医保户口、气候与环境几笔账；
3. 只列书里真正相关、能帮上的条目（例如第 19 节第 19 条的医保关系转移、第 24 节第 4 条的跨省异地就医），并给出核实渠道；
4. 追问要问能改变判断的事实（去当地靠什么收入、孩子上公立还是私立、户口社保是否迁、能否先租一年试住），不要只问孩子年龄、是否缴个税。
5. 读者愿意补充当地事实（房租、学校、offer、户口计划）时，下一轮可以拿这些事实做具体比较，但会标明「这是你提供的信息」，不会当成书里的内容。

这条已经加进评测集（`partial-relocation-hainan`），检索至少要把「换城市转移养老和医保关系」「跨省异地就医」两条带回来。回答层的规则写在 `SYSTEM_PROMPT` 的「先判断这题书里能答到哪」和「怎么写」两段。

## 本地跑

页面要通过 http 打开才能读 `README.md` 和 `book/`：

```bash
python -m http.server 8000
# 打开 http://localhost:8000/ask.html
```

移动端适配检查（需要 Chrome；覆盖 280 / 320 / 360 / 390 / 412 / 717 / 844 / 1024 八种尺寸，含弹窗、侧栏和长文，截图在 `/tmp/mobile-check-*.png`）：

```bash
node --experimental-websocket tools/mobile-check.mjs   # Node 20
node tools/mobile-check.mjs                            # Node 22+
```

### 不花 Key 的本地联调

`tools/ask/mock-server.mjs` 同时做静态服务器和假的 OpenAI 接口，会把提示词里的条目拼成一段带引用的回答，用 SSE 流式吐回来：

```bash
node tools/ask/mock-server.mjs          # 默认 8787 端口
# 打开 http://127.0.0.1:8787/ask.html?dev=mock&q=替朋友担保签不签
```

`?dev=mock` 只在 `localhost` / `127.0.0.1` 上生效，会打开设置、把接口指到本地 mock，不会写线上配置。把 `dev=mock` 换成 `dev=retrieve` 可以测「不配 Key 的检索模式」。

### 自动冒烟测试

无头 Chrome 走完这些路：先问后答（选项提交和直接回答两条路）、决策打分板（四态、重要性、未知待补、实时排名、最终建议）、完整回答、处理过程面板和流式思考、推理模型参数、兼容重试、后置追问卡、表格渲染、坏引用标红、报错、覆盖判断、没 Key 的检索模式，以及对话历史的保存、恢复、删除和清空。

```bash
node --experimental-websocket tools/ask/smoke.mjs   # Node 20
node tools/ask/smoke.mjs                            # Node 22+
```

Chrome 不在默认位置就设 `CHROME=/path/to/Chrome`。截图输出到 `/tmp/ask-smoke.png`。

## 检索评测

`tools/ask/cases.json` 是 42 道题的评测集（书内 26、急症 4、自杀 2、法律 3、个人情况 2、部分覆盖 1、书外 4）。`eval.mjs` 跑的是网页上同一份检索代码：

```bash
node tools/ask/eval.mjs            # 看 top1/top3/top10 和失败题
node tools/ask/eval.mjs --check    # 阈值：top10 全中、top3 ≥90%、top1 ≥80%
node tools/ask/check-coverage.mjs  # 覆盖判断和提示词注入
node tools/ask/check-catalog.mjs   # 服务商/模型目录结构
node tools/ask/check-decision.mjs  # 决策板打分
```

CI 里是 `book.yml` 的「问答检索评测」job。想连真实模型跑完整回答，设置 `ASK_API_KEY`、`ASK_BASE_URL`、`ASK_MODEL` 后加 `--gen`，会统计回答里的引用有多少能对回本次检索。注意这会花 API 额度。

评测集是人工按当前正文挑的，改正文后用 `node tools/ask/eval.mjs` 复查一遍；新发现检索不到的真实问法，补进 `cases.json`。

## 文件分工

| 文件 | 作用 |
| --- | --- |
| `ask.html` | 页面：设置、我的情况、聊天、流式请求、引用渲染与校验、依据速览、原文弹窗、对话历史 |
| `ask/agent.js` | 纯逻辑：解析正文、分词、检索、个人情况加权、提示词、引用校验、安全兜底；浏览器和 Node 共用 |
| `tools/ask/cases.json` | 42 道评测题和期望条目 |
| `tools/ask/eval.mjs` | 检索评测；`--check` 供 CI 用 |
| `tools/ask/check-coverage.mjs` | 覆盖判断单测：partial / none / auto 和提示词注入 |
| `ask/providers.js` | 服务商和模型名的唯一来源（官方来源、默认值、旧模型迁移） |
| `ask/decision.js` | 决策板四态打分、未知排除、排名和敏感性 |
| `tools/ask/check-catalog.mjs` | 目录结构和旧模型迁移单测，CI 里跑 |
| `tools/ask/check-decision.mjs` | 决策板四态、未知排除、排名和敏感性单测 |
| `tools/ask/mock-server.mjs` | 本地假模型 + 静态服务器 |
| `tools/ask/smoke.mjs` | 无头 Chrome 冒烟测试 |
| `tools/mobile-check.mjs` | 无头 Chrome 移动端适配检查（index / ask / selfcheck） |

## 维护注意

- **正文改了不用动这里**：页面每次打开都重新读 `README.md` 和 `book/*.md`，条目增删改自动生效。
- **不要改条目格式而不改解析器**：`ask/agent.js` 里的 `parseReadme()` 是 `index.html` 那一份的镜像。改条目字段名、成本标签格式时，两处一起改，并跑一遍评测。
- **答题规则和 skill 同源**：`ask/agent.js` 的 `SYSTEM_PROMPT` 是从 `skills/life-decision-guide/SKILL.md` 改写的。改了急症/自杀先停、四档受益人、法律过程成本这类回答规则，两边一起改，否则网页和 skill 会答得不一样。
- **改页面展示要连着改冒烟测试**：对话布局、处理过程面板、来源分组、依据速览、原文弹窗、追问卡、设置弹窗、对话历史都在 `tools/ask/smoke.mjs` 里有断言；改完跑一遍，并看一眼 `/tmp/ask-smoke.png`、`/tmp/ask-entry.png`、`/tmp/ask-process.png`、`/tmp/ask-mobile.png`。
- **依据速览和原文弹窗只读正文**：`renderBasis()` 从 `corpus.byRef` 直接取 `human`、证据等级和争议标记，`openEntry()` 用同一份数据渲染整条原文，不让模型参与；改条目的字段名时两处一起改（`sourceCard()`、`openEntry()`、`renderBasis()`）。
- **对话历史**：`recordTurn()` 在每轮结束（回答、只检索、没找到）时把问题和回答写进 `localStorage` 的 `hltb.ask.history`；`openConv()` 用 `renderSavedTurn()` 还原成原来的卡片，引用和来源靠存的条号从当前正文里重新取。改保存结构时要兼容旧记录（`loadHistory()` 会丢掉坏数据），并跑冒烟测试里的「对话历史」场景。别把 API Key 写进去。
- **成本标签和人群**：检索会读 `<!-- 成本标签 -->` 里的钱/时间/毅力/收益/口径/人群，和检索页同一套含义。
- **安全兜底**：问题里出现急症或自杀相关词时，页面先显示 120 / 12356，并把对应的急救条目顶到前面；提示词也要求模型第一段先给行动。不要为了「排序好看」把这些兜底删掉。
- **引用校验是最后一道闸**：模型仍可能编数字。页面只能核对条号是否存在、是否来自本次检索，核对不了数字。回答里的数字要回原文看。
- **许可**：页面代码 MIT（见仓库根目录 `LICENSE-CODE`）；正文 CC BY 4.0。
