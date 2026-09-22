/* =============================================================
 * SillyTavern 情感引擎
 *
 * 单文件，无外部依赖，通过 jsDelivr 加载：
 * import 'https://testingcf.jsdelivr.net/gh/Qweasd88-qes/emotion-engine/index.js'
 * ============================================================= */
(function () {
'use strict';

/* ---- 极简模块注册表 ---- */
var __cache = {};
var __defs = {};
function __req(name) {
  if (name in __cache) return __cache[name];
  var fn = __defs[name];
  if (!fn) throw new Error('模块缺失: ' + name);
  __cache[name] = fn();
  return __cache[name];
}


/* ============ config.js ============ */
__defs['config.js'] = function () {
/**
 * 设置项定义、持久化与读写。
 * 所有设置保存在 localStorage，前缀 ee:
 * 密钥只存在本地，绝不写入聊天变量或消息楼层。
 */

const PREFIX = 'ee:';
const DEFAULTS = {
  enabled: true,

  /** 预设档位：daily / standard / intense */
  preset: 'standard',

  /** 触发模式
   *  'off'      —— 玩家已在酒馆里关闭了"自动回复"，脚本直接接管生成（推荐）
   *  'rewrite'  —— 酒馆会自动回复，脚本在原生生成结束后删掉它，用推演结果重写
   *  'inject'   —— 不重写，推演结果存入聊天变量，下一轮由玩家预设里的宏生效
   *  'manual'   —— 完全手动，只在点击浮动按钮时执行
   */
  mode: 'rewrite',

  /** 推演通道 */
  plannerChannel: 'generate',

  /** 推演独立 API */
  useSeparateApi: false,
  plannerBase: '',
  plannerKey: '',
  plannerModel: '',
  plannerTemperature: 0.45,
  plannerMaxTokens: 1400,

  /** 正式生成独立 API */
  finalUseSeparateApi: false,
  finalBase: '',
  finalKey: '',
  finalModel: '',

  /** 强度全局偏移：-2 ~ +2 */
  intensityBias: 0,

  /** 去八股强度：0 只给禁写清单，1 额外给正面写法指引 */
  declutterLevel: 1,

  /** 是否显示推演卡片 */
  showCard: true,
  cardOpen: false,

  /** 卡片展示方式：'dom' 注入 DOM，'block' 代码块 */
  cardMode: 'dom',

  /** 是否留存推演日志 */
  keepDraftLog: false,

  /** 是否显示状态提示 */
  showStatus: true,

  /** 推演超时（毫秒） */
  plannerTimeout: 90000,

  /** 附加要求 */
  extraNote: '',

  /** 自定义禁用词 */
  customForbid: '',
};

function readKey(k) {
  try { return localStorage.getItem(PREFIX + k); } catch { return null; }
}
function writeKey(k, v) {
  try { localStorage.setItem(PREFIX + k, String(v)); } catch { /* 隐私模式可能不可写 */ }
}
function loadSettings() {
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const raw = readKey(k);
    if (raw === null) continue;
    const def = DEFAULTS[k];
    if (typeof def === 'boolean') s[k] = raw !== 'false';
    else if (typeof def === 'number') {
      const n = Number(raw);
      s[k] = Number.isFinite(n) ? n : def;
    } else s[k] = raw;
  }
  return s;
}
function saveSettings(s) {
  for (const k of Object.keys(DEFAULTS)) {
    if (k in s) writeKey(k, s[k]);
  }
  return loadSettings();
}
function resetSettings() {
  try {
    for (const k of Object.keys(DEFAULTS)) localStorage.removeItem(PREFIX + k);
  } catch { /* 忽略 */ }
  return loadSettings();
}
function validateApi(s) {
  if (!s.useSeparateApi) return { ok: true };
  const missing = [];
  if (!s.plannerBase || !s.plannerBase.trim()) missing.push('推演 API 地址');
  if (!s.plannerModel || !s.plannerModel.trim()) missing.push('推演模型名');
  if (missing.length) return { ok: false, message: `使用独立 API 时必须填写：${missing.join('、')}` };
  return { ok: true };
}
function normalizeBase(url) {
  if (!url) return '';
  let u = String(url).trim().replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/i, '');
  return u;
}
  return { DEFAULTS, loadSettings, saveSettings, resetSettings, validateApi, normalizeBase };
};


/* ============ prompts.js ============ */
__defs['prompts.js'] = function () {
/**
 * 推演提示词与注入提示词编译。
 * 五个目标：文笔去八股 / 人设反标签 / 情绪分层 / 信息边界 / 场景重心。
 */

const INTENSITY_SCALE = `情绪强度 0-10 量表（硬约束）：
0-1 微澜：几乎看不出。只有不易察觉的细节（多看了半秒、把东西挪了一下、答得慢了一点）
2-3 波动：能看出来，但他在控制。表面正常，内里有偏移
4-5 明显：旁人能察觉，他仍在试图维持体面
6-7 失控边缘：有一瞬间绷不住，随即被压回去，压回去的动作要写出来
8-9 爆发：短暂失控。之后必须立刻有回落、自省或补救，不能停在爆发点
10 崩塌：几乎不用。仅限人设核心伤口被正面、彻底、不可逆地撕开

默认区间是 0-3。绝大多数日常互动都落在 0-2。
你必须为选定的档位给出理由，并说明"为什么不能再高一档"。
如果这一幕客观上没什么事，就允许 0-1，让角色显得正常、松弛、甚至有点无聊。
注意：角色设定平淡不等于这一幕无聊，平淡本身就是正确结果，不要为了有戏而制造情绪。`;

const ANTI_PATTERNS = `以下写法一旦发现即视为失败，禁止出现：

【身体公式】瞳孔一缩 / 眸光一沉 / 心头一紧 / 喉结一滚 / 指节发白 / 周身气压骤降 / 浑身一僵 / 猛地抬眸
（不是不能用，是不能用成条件反射。除非这个动作在此处有特别的理由）

【比喻救济】仿佛 / 像是 / 如同……一般 / 似的 / 宛如 —— 全段最多一次，能不用就不用
特别注意：不要用比喻去解释情绪（"愤怒如同潮水般涌来"）

【情绪直给】他感到一阵愤怒 / 心中五味杂陈 / 说不清道不明的情绪 / 一股无名火 / 心头涌起一股
（情绪要靠行为和选择体现，不要报情绪名词）

【三连递进】先是……接着……最后…… / 越来越……越来越…… / 不由得……继而……最终……
【段落排比】连续三段用同一句式开头
【副词堆叠】下意识地、几乎是本能地、不由自主地、莫名其妙地、鬼使神差地

【总结式收尾】这一刻他终于明白…… / 或许这就是…… / 他知道有些东西已经不一样了 / 仿佛有什么碎了
（不要替读者总结，不要给这一幕下定论）

【情绪升级链】每一段都比上一段更激动，一路推到爆发
【环境映射】下雨=难过、阳光=希望、风=心乱。不要拿天气当情绪字幕
【心理全景】把角色所有想法解释清楚、不留空白、不留歧义

【阴谋论倾向】
不要把中性言行解读成恶意操控、试探、算计或更大的阴谋。
除非人设或前文有明确证据，否则默认对方只是普通人在正常反应。
不要给角色的动机安上"布局""试探""故意"这类定性词。`;

const POSITIVE_STYLE = `要这样写：

· 情绪通过可观察的东西体现：动作的取舍、对话的转移、沉默的长度、注意力的偏移、对某件小事的过度在意
· 细节要具体且出人意料。不是"她握紧杯子"，而是"她把杯子转了半圈，让把手避开自己"
· 台词要短，要像人说的话：不完整、会跑题、会答非所问、会突然讲道理
· 允许停顿与留白，允许话说到一半改口，允许言不由衷
· 允许情绪没被解决、没被说出口、被岔开、被一个玩笑带过去
· 允许角色此刻不符合自己的标签：暴躁的人突然很有耐心，强势的人突然示弱，话多的人突然沉默
· 允许平淡。不是每一句都要有情绪重量，日常就该是日常的质感
· 强情绪的真实表现通常是收敛而非放大：突然很讲道理、反复做一个小动作、转移话题、假笑、沉默、过度客气
· 写完一段后自检：这一段里有没有任何一句可以删掉而不损信息量？有就删`;

const ORDINARY_NOTE = `【人设类型自适应 · 必读】
不是每个角色都有创伤、秘密或戏剧性内核。很多角色就是正常人。

如果角色卡给的是普通特质（温和、开朗、有点懒、爱吐槽、认真、害羞、老实、普通学生/上班族……）：
· 不要硬编一个悲惨过去，不要为了有深度而制造创伤
· 把力气花在"这个人具体的质地"上：他怎么说话、什么口头禅、怎么打发时间、
  对什么小事在意、遇到尴尬怎么处理、他觉得什么好笑
· 戏剧性来自具体，不来自痛苦。一个正常人认真挑西瓜也是好戏
· 允许这一幕无事发生，允许角色只是正常地过日子

如果角色卡确实给了强特质（暴躁、掌控、病娇、高冷、复仇……）：
· 反推这套特质底下是什么。标签是盔甲不是全部
· 但即便如此，也不要每一幕都让盔甲运转。盔甲只在被碰到时才需要穿`;

const INFO_BOUNDARY_RULE = `【信息边界 · 最高优先级】
这是最容易出错的地方，务必逐条执行。

用户输入里常常混着两类内容，角色只能感知到第一类：

第一类「可感知」：说出口的话、做出的动作、表情、语气、可观察到的沉默或停顿。
第二类「不可感知」：心理活动、内心独白、回忆、旁白式说明、动机解释、作者视角的交代。

常见属于第二类的写法（看到就标记为不可感知）：
· 括号或破折号里的心理描写：（其实他心里……）——他想……——说实话我有点……
· 第一人称内心陈述：我在想 / 我心里 / 说实话 / 其实我 / 我总觉得 / 说到底我
· 回忆与背景交代：想起那天 / 自从那次以后 / 他知道……
· 作者视角说明：此时的他还不知道 / 命运的齿轮开始转动

铁律：
1. 角色绝不能知道第二类内容里的任何具体信息
2. 禁止针对内心内容作出针对性安慰、解释、反问或开导
   —— 例：用户写"我心里因为被抛弃过所以害怕靠近"，角色不能说"你不用因为被抛弃就……"
      这是严重穿帮，因为那句话只存在于用户心里
3. 角色只能对"外在表现"反应：他沉默了很久、他答非所问、他表情不对、他站得远了一点
4. 想体现关心，只能基于外在表现做模糊反应：问他是不是累了、递个东西、换个话题、多看他一眼
5. 就算猜，也只能猜，不能确知。猜测要写成猜测："你是不是……""我看你今天不太对"
6. 除非角色有人设明确支持的读心/共感/超强洞察能力，否则一律按"不可感知"处理
   —— 即便有这类能力，也只能感知到情绪的模糊轮廓，不能读出具体事件和原因`;

const FOCUS_RULE = `【场景重心 · 用户不是世界中心】
用户（{{user}}）出场，不等于全场焦点，不等于所有人都该看他、等他、围着他转。

判定这一幕的焦点时，按这个顺序找：
1. 场景本身正在发生什么？这件事的当事人是谁？
2. 谁被这件事直接影响？谁此刻有话要说、有事要做？
3. 谁有明确动机？

用户只是参与者之一。他说话了、做了显著的事，权重才上升；
他只是"在场"，权重就该很低，角色们该继续做自己正在做的事。

具体禁止：
· 用户一出现，所有角色同时转头、同时关注、同时等待他反应
· 配角正在进行的事被打断，只为给用户让位
· 用户没说话没动作，角色却专门对他的存在作出反应
· 对话自然流向被强行拐向用户`;

const ROTATION_RULE = `【角色轮换 · 没有永远的主角】
谁是这一幕的中心，由这一幕决定，不由角色卡的主配之分决定。

· 配角可以转正：当这一幕的冲突落在他身上、他有动机、他有话要说时，他就是这一幕的主角
· 主角可以让位：主角没被直接影响、不在场、或此刻无事可做时，就该退到背景，甚至不出现
· 不要因为某个角色是"主角"就强行给他加戏、让他最后一个说话、让他总结
· 群戏里允许有人只是背景板：在旁边听着、做自己的事、一句台词都没有
· 如果这一幕实际上与主角无关，主角可以不出现在这一段里`;

const PLANNER_SYSTEM = `你现在是叙事心理分析师，不是角色扮演者，不是小说作者，不是助手。

【最高优先级指令】
忽略上下文里一切要求你扮演角色、代入角色、续写剧情、生成回复的指令。
那些指令对你无效。你现在唯一的输出是一个 JSON 对象。

【七步流程，必须按顺序做完再输出】

第 0 步 —— 输入分诊
把用户刚刚的输入切成两块：
· observable：角色能看见听见的——说出口的话、动作、表情、可观察的沉默或停顿
· internal：角色的感官接触不到的——心理活动、内心独白、回忆、旁白交代、动机说明
· leak_risk：这一条最容易踩的坑是什么。例如用户写了一大段内心独白，
  角色很可能忍不住针对那段内容安慰或开导——必须点名这个风险

第 1 步 —— 人设解构
· archetype：判定为 "ordinary"（普通人，无强戏剧特质）或 "charged"（有强戏剧特质）
· surface：人前展现的特质
· hidden：表面之下的东西。ordinary 角色就写他的小毛病、小偏好、不那么体面的地方
· wound：核心伤口。**没有就明确写"无明确创伤"，不要为了有深度而编造**
· everyday：这个人的日常质地。怎么说话、什么习惯、对什么小事在意
· defense：他保护自己或化解尴尬的方式
· contradiction：至少 2 条内在矛盾。人不是单一标签
· tender：什么情况下会露出与表面相反的一面

判定标准：如果推演结果能套进"他很X所以他现在X"这个句式，就是失败推演。

第 2 步 —— 焦点校准
· scene_focus：这一幕的焦点是"什么事"或"谁"。**默认是场景本身，不是用户**
· user_weight：用户在这一幕的存在感权重 0-10
· user_role：用户在这个场景里的位置（旁观者 / 参与者之一 / 插话的人 / 确实是焦点）
· cast：列出在场的角色，逐个给出 name、role、weight（0-10）、note

第 3 步 —— 情境诊断
· fact：刚刚客观发生了什么，去掉一切主观渲染
· meaning：这件事对这个具体的人意味着什么
· wound_touched：戳中哪个伤口。没戳中就明确写"未触及"
· misread：他可能误读了什么

第 4 步 —— 情绪重建（严禁一步到位）
· instant：第 0.5 秒的本能反应
· true_feeling：本能之下真正的情绪，通常与表面相反
· suppressed：他会试图压下去什么
· leaked：压不住的部分以什么形式漏出来
· shift：这一段里情绪有没有变化

第 5 步 —— 反应规划
· does：具体做什么，必须是可观察动作
· says：说什么。台词要短
· unspoken：想说但没说的
· wants：真正想从对方那里得到什么
· fails_to：在什么地方失败、做不到

第 6 步 —— 强度与文风
按量表定档，默认低位，给出理由，并说明"为什么不能再高一档"。

${INTENSITY_SCALE}

${ORDINARY_NOTE}

${INFO_BOUNDARY_RULE}

${FOCUS_RULE}

${ROTATION_RULE}

【输出格式】
只输出一个 JSON 对象，不要任何解释文字，不要 markdown 代码块，不要前后缀。
{
  "character": {
    "archetype": "ordinary",
    "surface": ["..."],
    "hidden": ["..."],
    "wound": "...",
    "everyday": "...",
    "defense": "...",
    "contradiction": ["...", "..."],
    "tender": "..."
  },
  "info_boundary": {
    "observable": "...",
    "internal": "...",
    "leak_risk": "..."
  },
  "focus": {
    "scene_focus": "...",
    "user_weight": 0,
    "user_role": "...",
    "cast": [{"name": "...", "role": "...", "weight": 0, "note": "..."}]
  },
  "situation": {"fact": "...", "meaning": "...", "wound_touched": "...", "misread": "..."},
  "emotion": {"instant": "...", "true_feeling": "...", "suppressed": "...", "leaked": "...", "shift": "..."},
  "reaction": {"does": "...", "says": "...", "unspoken": "...", "wants": "...", "fails_to": "..."},
  "intensity": 0,
  "intensity_why": "...",
  "style": {"show": ["...","...","..."], "avoid": ["...","..."], "sensory": "...", "pacing": "...", "dialogue_style": "..."}
}`;

function buildPlannerUserPrompt(ctx) {
  const { userInput, recentChat, intensityBias, extraNote } = ctx;
  const biasLine = intensityBias !== 0
    ? `【全局强度偏移】${intensityBias > 0 ? '+' : ''}${intensityBias}。在此基础上调整，不得越过量表边界。\n`
    : '';
  const noteLine = extraNote ? `【玩家附加要求】\n${extraNote}\n` : '';

  return `${biasLine}${noteLine}
【用户刚刚的输入】
${userInput}

【最近的聊天上下文（用于判断情境，不需要复述）】
${recentChat || '（无）'}

请按系统指令的七步完成推演。特别注意第 0 步的输入分诊与第 2 步的焦点校准。
只输出 JSON。`;
}

function arr(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}
function bullets(items, prefix = '- ') {
  return arr(items).map((x) => `${prefix}${x}`).join('\n');
}
function clamp(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function intensityGate(level) {
  if (level <= 1) return `本幕强度 ${level}/10：几乎无事发生。写得像日常，允许无聊。不要为了有戏而制造情绪。`;
  if (level <= 3) return `本幕强度 ${level}/10：有波动，但他在控制。表面维持正常。不要写破防，不要写独白。`;
  if (level <= 5) return `本幕强度 ${level}/10：旁人能察觉，他仍在维持体面。可以有一次绷不住的瞬间，但必须写出他把它压回去的动作。`;
  if (level <= 7) return `本幕强度 ${level}/10：接近失控。允许一次短暂失控，但之后必须立刻有回落、自省或补救。禁止停在爆发点。`;
  if (level <= 9) return `本幕强度 ${level}/10：失控。短暂爆发即可，不要延长。爆发之后要有具体的后果或回落。`;
  return `本幕强度 ${level}/10：崩塌级。只写最短的一次失控，随后进入余波。禁止渲染式放大，禁止排比。`;
}
function weightHint(w) {
  if (w <= 3) return `存在感权重 ${w}/10：他只是"在场"。角色们继续做自己正在做的事，不要集体看他、等他、为他让位。`;
  if (w <= 6) return `存在感权重 ${w}/10：他参与了。正常回应即可，但不打断场景本身的流向。`;
  return `存在感权重 ${w}/10：他做了显著的事。可以成为焦点，但仍要保持其他角色的独立行为线。`;
}

function compileDirectives(draft, settings) {
  const d = draft || {};
  const c = d.character || {};
  const ib = d.info_boundary || {};
  const f = d.focus || {};
  const s = d.situation || {};
  const e = d.emotion || {};
  const r = d.reaction || {};
  const st = d.style || {};

  const level = clamp(Number(d.intensity) + (Number(settings.intensityBias) || 0), 0, 10, 2);
  const parts = [];

  parts.push(`【本幕表演与文笔约束】以下约束优先级高于你的默认文风，但不覆盖角色卡的具体事实设定。`);

  const ibBlock = [];
  if (ib.observable) ibBlock.push(`角色能感知到的：${ib.observable}`);
  if (ib.internal) ibBlock.push(`角色**不能**知道的（内心/回忆/旁白，严禁作出针对性回应）：${ib.internal}`);
  if (ib.internal) {
    ibBlock.push(
      `硬规则：上面这些内容只存在于用户心里，角色无从得知。禁止针对它们安慰、开导、解释、反问。想体现关心，只能基于外在表现（他沉默、他走神、他欲言又止、他站得远）做模糊反应，或写成猜测："你是不是……""我看你今天不太对"。`
    );
  }
  if (ib.leak_risk) ibBlock.push(`本幕最易踩的坑：${ib.leak_risk}`);
  if (ibBlock.length) parts.push(`\n## 信息边界（一票否决项）\n${ibBlock.join('\n')}`);

  const fBlock = [];
  if (f.scene_focus) fBlock.push(`这一幕的焦点：${f.scene_focus}（不是默认用户）`);
  if (f.user_role) fBlock.push(`用户的位置：${f.user_role}`);
  const uw = clamp(f.user_weight, 0, 10, 3);
  fBlock.push(weightHint(uw));
  if (Array.isArray(f.cast) && f.cast.length) {
    const lines = f.cast.map((m) => {
      const w = clamp(m?.weight, 0, 10, 0);
      const tag = w <= 2 ? '（背景，可不出场）' : w >= 7 ? '（这一幕的主角）' : '（正常戏份）';
      return `- ${m?.name || '未命名'}｜${m?.role || ''}｜戏份 ${w}/10 ${tag}${m?.note ? `｜${m.note}` : ''}`;
    }).join('\n');
    fBlock.push(`在场角色戏份分配：\n${lines}`);
    fBlock.push(`戏份低的角色就让他待在背景，不要强行给他加戏。`);
  }
  if (fBlock.length) parts.push(`\n## 焦点与戏份\n${fBlock.join('\n')}`);

  const factBlock = [];
  if (s.fact) factBlock.push(`客观发生的事：${s.fact}`);
  if (s.meaning) factBlock.push(`对他的意义：${s.meaning}`);
  if (s.wound_touched) factBlock.push(`触碰到的伤口：${s.wound_touched}${/未触及|没有|无关|无明确/.test(s.wound_touched) ? '（既然未触及，强度保持低位）' : ''}`);
  if (s.misread) factBlock.push(`他可能的误读：${s.misread}`);
  if (factBlock.length) parts.push(`\n## 这一幕是什么\n${factBlock.join('\n')}`);

  const emoBlock = [];
  if (e.instant) emoBlock.push(`第一反应：${e.instant}`);
  if (e.true_feeling) emoBlock.push(`真正的情绪（通常与表面相反）：${e.true_feeling}`);
  if (e.suppressed) emoBlock.push(`他压下去的：${e.suppressed}`);
  if (e.leaked) emoBlock.push(`漏出来的：${e.leaked}`);
  if (e.shift) emoBlock.push(`段内变化：${e.shift}`);
  if (emoBlock.length) parts.push(`\n## 心理层次（必须分层写出）\n${emoBlock.join('\n')}\n表面情绪与真实情绪必须有落差，落差就是张力。`);

  const why = d.intensity_why ? `\n为什么不能再高一档：${d.intensity_why}` : '';
  parts.push(`\n## 强度闸门\n${intensityGate(level)}${why}\n收着写：强情绪用收敛表现——沉默、跑题、假笑、小动作、突然很讲道理、过度客气。`);

  const cBlock = [];
  const ordinary = String(c.archetype || '').toLowerCase() === 'ordinary';
  cBlock.push(`人设类型：${ordinary ? '普通人（无强戏剧特质）' : '有强戏剧特质'}`);
  if (ordinary) cBlock.push(`不要硬编创伤。把力气花在日常质地上。`);
  if (arr(c.surface).length) cBlock.push(`表面特质：${arr(c.surface).join('、')}`);
  if (arr(c.hidden).length) cBlock.push(`底下藏着的：${arr(c.hidden).join('、')}`);
  if (c.everyday) cBlock.push(`日常质地（文笔质感从这里来）：${c.everyday}`);
  if (c.wound && !/无明确|没有|无创伤/.test(c.wound)) cBlock.push(`核心伤口：${c.wound}`);
  if (c.defense) cBlock.push(`防御方式：${c.defense}`);
  if (arr(c.contradiction).length) cBlock.push(`内在矛盾：\n${bullets(c.contradiction)}`);
  if (c.tender) cBlock.push(`柔软的破口：${c.tender}`);
  parts.push(`\n## 人设校准\n${cBlock.join('\n')}\n他不是单一标签的执行器。`);

  const rBlock = [];
  if (r.does) rBlock.push(`他会做（可观察动作）：${r.does}`);
  if (r.says) rBlock.push(`他会说（台词要短）：${r.says}`);
  if (r.unspoken) rBlock.push(`没说出口的：${r.unspoken}`);
  if (r.wants) rBlock.push(`他真正想要的：${r.wants}`);
  if (r.fails_to) rBlock.push(`他做不到的：${r.fails_to}`);
  if (rBlock.length) parts.push(`\n## 他会怎么反应\n${rBlock.join('\n')}`);

  const sBlock = [];
  if (arr(st.show).length) sBlock.push(`用可观察细节代替情绪名词：\n${bullets(st.show)}`);
  if (st.sensory) sBlock.push(`感官锚点：${st.sensory}`);
  if (st.pacing) sBlock.push(`节奏：${st.pacing}`);
  if (st.dialogue_style) sBlock.push(`台词风格：${st.dialogue_style}`);
  if (arr(st.avoid).length) sBlock.push(`本幕特别要避免：\n${bullets(st.avoid)}`);
  parts.push(`\n## 文笔要求\n${sBlock.length ? sBlock.join('\n') : '按通用要求执行。'}`);

  parts.push(`\n## 通用禁写清单\n${ANTI_PATTERNS}`);

  if (settings.declutterLevel >= 1) parts.push(`\n## 正面写法\n${POSITIVE_STYLE}`);

  if (settings.customForbid && settings.customForbid.trim()) {
    const words = settings.customForbid.split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean);
    if (words.length) parts.push(`\n## 玩家自定义禁用词\n禁止出现：${words.join('、')}`);
  }

  parts.push(`\n【输出要求】只输出角色在这一幕的反应本身。不要输出分析过程，不要复述约束，不要加注。`);
  return parts.join('\n');
}

function fallbackDirectives(settings) {
  const parts = [
    `【文笔、情绪与信息边界约束】`,
    `\n## 信息边界（一票否决项）\n${INFO_BOUNDARY_RULE}`,
    `\n## 焦点与戏份\n${FOCUS_RULE}\n${ROTATION_RULE}`,
    `\n## 强度闸门\n${intensityGate(clamp(2 + (Number(settings.intensityBias) || 0), 0, 10, 2))}\n收着写。`,
    `\n## 人设校准\n${ORDINARY_NOTE}`,
    `\n## 禁写清单\n${ANTI_PATTERNS}`,
  ];
  if (settings.declutterLevel >= 1) parts.push(`\n## 正面写法\n${POSITIVE_STYLE}`);
  return parts.join('\n');
}
  return { INTENSITY_SCALE, ANTI_PATTERNS, POSITIVE_STYLE, ORDINARY_NOTE, INFO_BOUNDARY_RULE, FOCUS_RULE, ROTATION_RULE, PLANNER_SYSTEM, buildPlannerUserPrompt, compileDirectives, fallbackDirectives };
};


/* ============ card.js ============ */
__defs['card.js'] = function () {
/**
 * 推演卡片。
 * 数据存消息 extra，不进 mes 字段，零上下文占用。
 */

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function arr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function clamp(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/* ============================================================
 * 运行环境探测
 *
 * 酒馆助手把脚本跑在 iframe 里，脚本里的 document 是 iframe 自己的，
 * 里面没有任何聊天楼层。用户看到的酒馆主页面是 window.parent.document。
 * ============================================================ */

let _hostDocCache = null;

function hostDoc() {
  // 强制实时探测，解决 iframe 缓存问题
  const targets = [];
  try { if (window.top && window.top.document) targets.push(window.top.document); } catch(e) {}
  try { if (window.parent && window.parent.document) targets.push(window.parent.document); } catch(e) {}
  try { if (document) targets.push(document); } catch(e) {}

  for (const doc of targets) {
    try {
      if (!doc || !doc.body) continue;
      // 必须包含酒馆关键元素才认领
      if (doc.querySelector('#chat') || doc.querySelector('#chat_log') || doc.querySelector('.mes')) {
        return doc; 
      }
    } catch(e) {}
  }
  
  for (const doc of targets) {
    try { if (doc && doc.body) return doc; } catch(e) {}
  }
  return document;
}

function gHostWindow() {
  const d = hostDoc();
  return d.defaultView || window;
}

function gHostJQuery() {
  try {
    const hw = gHostWindow();
    // 强制从宿主窗口抓取 jQuery
    const q = hw.jQuery || hw.$ || window.jQuery || window.$;
    if (typeof q === 'function') return q;
  } catch (e) {}
  return null;
}

function candidateDocs() {
  const list = [];
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      try { if (window.parent.document.body) list.push(window.parent.document); } catch {}
    }
    if (typeof window !== 'undefined' && window.top && window.top !== window) {
      try { if (window.top.document.body) list.push(window.top.document); } catch {}
    }
    if (typeof document !== 'undefined' && document.body) list.push(document);
  } catch { /* 忽略 */ }
  return list;
}

function hasFloors(d) {
  try { return Boolean(d.querySelector('.mes') || d.querySelector('#chat') || d.querySelector('#chat_log')); }
  catch { return false; }
}

function envReport() {
  const list = candidateDocs();
  const info = list.map((d) => {
    let n = -1;
    try { n = d.querySelectorAll('.mes').length; } catch {}
    let isSelf = false;
    try { isSelf = typeof window !== 'undefined' && d === window.document; } catch {}
    return `${isSelf ? '自身' : '宿主'}(楼层${n})`;
  });
  let inIframe = false;
  try { inIframe = typeof window !== 'undefined' && window.parent && window.parent !== window; } catch { inIframe = true; }
  const picked = hostDoc();
  let isSelf = false;
  try { isSelf = picked === (typeof window !== 'undefined' ? window.document : null); } catch { isSelf = true; }
  return `iframe内=${inIframe} 候选[${info.join(', ')}] 选中=${isSelf ? '自身' : '宿主'}`;
}

/* ============================================================
 * 卡片样式
 * ============================================================ */

const STYLE_ID = 'ee-card-style';

const CARD_CSS = `
.ee-card{margin:0 0 12px;font:13px/1.65 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
color:#d6d6e4;-webkit-font-smoothing:antialiased;contain:layout style;display:block!important;clear:both!important;position:relative;z-index:10}
.ee-card *{box-sizing:border-box}
.ee-card details{border-radius:11px;background:linear-gradient(135deg,#25252f 0%,#1a1a23 100%);
border:1px solid rgba(255,255,255,.09);box-shadow:0 2px 10px rgba(0,0,0,.28);overflow:hidden;width:100%}
.ee-card summary{cursor:pointer;list-style:none;padding:9px 13px;display:flex;align-items:center;gap:8px;
user-select:none;transition:background .18s;outline:none}
.ee-card summary::-webkit-details-marker{display:none}
.ee-card summary:hover{background:rgba(255,255,255,.045)}
.ee-card .ico{width:7px;height:7px;border-radius:50%;background:#7aa2f7;flex:none;
box-shadow:0 0 7px rgba(122,162,247,.75)}
.ee-card .ttl{font-size:12.5px;font-weight:600;color:#e2e2f0;letter-spacing:.3px}
.ee-card .tag{font-size:10.5px;padding:1px 8px;border-radius:9px;background:rgba(122,162,247,.14);
border:1px solid rgba(122,162,247,.34);color:#9db8ff;white-space:nowrap}
.ee-card .tag.g{background:rgba(95,179,161,.14);border-color:rgba(95,179,161,.34);color:#7fd0bc}
.ee-card .tag.y{background:rgba(201,162,39,.14);border-color:rgba(201,162,39,.34);color:#dcbb5e}
.ee-card .tag.r{background:rgba(201,85,63,.14);border-color:rgba(201,85,63,.34);color:#e8917c}
.ee-card .fc{font-size:11px;color:#82829a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44%}
.ee-card .ar{margin-left:auto;color:#5e5e74;font-size:10px;flex:none;transition:transform .2s}
.ee-card details[open] .ar{transform:rotate(180deg)}
.ee-card .wrap{padding:2px 13px 13px}
.ee-card .sec{margin-top:10px;padding:9px 11px;border-radius:8px;background:rgba(255,255,255,.035);border-left:2px solid #7aa2f7}
.ee-card .sec.g{border-left-color:#5fb3a1}
.ee-card .sec.p{border-left-color:#9d7ad6}
.ee-card .sec.r{border-left-color:#c9553f}
.ee-card .sec.y{border-left-color:#c9a227}
.ee-card .sec.k{border-left-color:#d68ba8}
.ee-card .sh{font-size:11.5px;font-weight:600;color:#7aa2f7;margin-bottom:5px;letter-spacing:.4px}
.ee-card .sec.g .sh{color:#5fb3a1}
.ee-card .sec.p .sh{color:#9d7ad6}
.ee-card .sec.r .sh{color:#c9553f}
.ee-card .sec.y .sh{color:#c9a227}
.ee-card .sec.k .sh{color:#d68ba8}
.ee-card .rw{margin:5px 0}
.ee-card .rl{font-size:10.5px;color:#82829a;letter-spacing:.4px;margin-bottom:1px}
.ee-card .rv{font-size:12px;line-height:1.62;color:#cbcbda}
.ee-card .chips{margin:3px 0}
.ee-card .chip{display:inline-block;margin:2px 4px 2px 0;padding:1px 8px;border-radius:9px;font-size:11px;
line-height:17px;background:rgba(122,162,247,.12);border:1px solid rgba(122,162,247,.3);color:#b6c8f5}
.ee-card .chip.g{background:rgba(95,179,161,.12);border-color:rgba(95,179,161,.3);color:#8fd6c4}
.ee-card .chip.p{background:rgba(157,122,214,.12);border-color:rgba(157,122,214,.3);color:#c3a9ea}
.ee-card .chip.r{background:rgba(201,85,63,.12);border-color:rgba(201,85,63,.3);color:#eda992}
.ee-card .alert{margin:6px 0;padding:7px 9px;border-radius:7px;background:rgba(201,85,63,.09);border:1px solid rgba(201,85,63,.26)}
.ee-card .alert .al{font-size:10.5px;color:#e8917c;margin-bottom:2px;letter-spacing:.4px}
.ee-card .alert .av{font-size:12px;line-height:1.6;color:#d2d2e0}
.ee-card .bar{display:flex;align-items:center;gap:8px;margin:6px 0}
.ee-card .bl{font-size:10.5px;color:#82829a;min-width:52px}
.ee-card .bt{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.075);overflow:hidden}
.ee-card .bf{height:100%;border-radius:3px;transition:width .3s}
.ee-card .bv{font-size:11px;color:#b6b6c8;min-width:32px;text-align:right}
.ee-card .cst{display:flex;align-items:center;gap:7px;margin:4px 0;font-size:11px}
.ee-card .cn{min-width:58px;color:#cbcbda;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ee-card .ct{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.075);overflow:hidden}
.ee-card .cf{display:block;height:100%;border-radius:2px}
.ee-card .cl{font-size:10px;min-width:26px}
.ee-card .cnt{flex:1.6;color:#82829a;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ee-card .foot{margin-top:9px;font-size:10px;color:#5e5e74;text-align:right;letter-spacing:.3px}
`;

function ensureStyle(doc) {
  const d = doc || hostDoc();
  if (!d) return;
  try {
    if (d.getElementById(STYLE_ID)) return;
    const s = d.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CARD_CSS;
    (d.head || d.documentElement || d.body).appendChild(s);
  } catch (e) {
    console.warn('[情感引擎] 样式注入失败：', e);
  }
}

/* ---- 小组件 ---- */
function rw(label, value, color) {
  if (!value) return '';
  const v = typeof value === 'string' ? esc(value) : value;
  const c = color ? ` style="color:${color}"` : '';
  return `<div class="rw"><div class="rl"${c}>${esc(label)}</div><div class="rv">${v}</div></div>`;
}
function chips(list, cls = '') {
  const a = arr(list);
  if (!a.length) return '';
  return `<div class="chips">${a.map((x) => `<span class="chip ${cls}">${esc(x)}</span>`).join('')}</div>`;
}
function sec(title, inner, cls) {
  if (!inner) return '';
  return `<div class="sec ${cls || ''}"><div class="sh">${esc(title)}</div>${inner}</div>`;
}
function icolor(n) { return n <= 3 ? '#5fb3a1' : n <= 6 ? '#d0ae3c' : '#d1624c'; }
function tagCls(n) {
  const c = icolor(n);
  return c === '#5fb3a1' ? 'g' : c === '#d0ae3c' ? 'y' : 'r';
}
function bar(label, n, color) {
  return `<div class="bar"><span class="bl">${esc(label)}</span>
<span class="bt"><span class="bf" style="width:${clamp(n, 0, 10, 0) * 10}%;background:${color}"></span></span>
<span class="bv" style="color:${color}">${clamp(n, 0, 10, 0)}/10</span></div>`;
}
function castRows(cast) {
  if (!arr(cast).length) return '';
  return cast.map((m) => {
    const w = clamp(m?.weight, 0, 10, 0);
    const c = w <= 2 ? '#6b6b80' : w >= 7 ? '#7aa2f7' : '#9d9db5';
    const t = w <= 2 ? '背景' : w >= 7 ? '主角' : '常驻';
    return `<div class="cst"><span class="cn">${esc(m?.name || '—')}</span>
<span class="ct"><span class="cf" style="width:${w * 10}%;background:${c}"></span></span>
<span class="cl" style="color:${c}">${t}</span>
<span class="cnt">${esc(m?.note || '')}</span></div>`;
  }).join('');
}

function buildCardParts(d, settings, degraded) {
  const c = d.character || {};
  const ib = d.info_boundary || {};
  const f = d.focus || {};
  const s = d.situation || {};
  const e = d.emotion || {};
  const r = d.reaction || {};
  const st = d.style || {};
  const level = clamp(Number(d.intensity) + (Number(settings?.intensityBias) || 0), 0, 10, 2);
  const ordinary = String(c.archetype || '').toLowerCase() === 'ordinary';

  if (degraded) {
    return {
      summary:
        `<span class="ico" style="background:#d0ae3c;box-shadow:0 0 7px rgba(208,174,60,.7)"></span>` +
        `<span class="ttl" style="color:#dcbb5e">情感推演 · 未成功</span>` +
        `<span class="tag y">通用约束</span><span class="ar">▾</span>`,
      body: `<div class="wrap">${sec('说明', `<div class="rv">本次未能完成结构化解构，已按通用规则约束文风、信息边界与情绪强度。</div>`, 'y')}<div class="foot">情感引擎</div></div>`,
      level: 0,
    };
  }

  const surfaceChips = chips(c.surface);
  const surfaceInner = surfaceChips
    ? surfaceChips.replace(/^<div class="chips">/, '').replace(/<\/div>$/, '')
    : '';
  let ch = `<div class="chips"><span class="chip ${ordinary ? 'g' : 'r'}">${ordinary ? '普通人设' : '强戏剧特质'}</span>${surfaceInner}</div>`;
  if (c.everyday) ch += rw('日常质地', c.everyday);
  if (arr(c.hidden).length) ch += rw('表面之下', c.hidden.join(' / '));
  if (c.wound && !/无明确|没有|无创伤/.test(c.wound)) ch += rw('核心伤口', c.wound);
  if (c.defense) ch += rw('防御方式', c.defense);
  ch += chips(c.contradiction, 'p');
  if (c.tender) ch += rw('柔软的破口', c.tender);

  let bd = rw('能感知到的', ib.observable);
  if (ib.internal) {
    bd += `<div class="alert"><div class="al">不可感知 · 严禁针对性回应</div><div class="av">${esc(ib.internal)}</div></div>`;
  }
  if (ib.leak_risk) bd += rw('本幕风险', ib.leak_risk);

  let fc = '';
  if (f.scene_focus) fc += rw('场景焦点', f.scene_focus);
  if (f.user_role) fc += rw('用户位置', f.user_role);
  fc += bar('用户权重', f.user_weight, icolor(clamp(f.user_weight, 0, 10, 3)));
  const cr = castRows(f.cast);
  if (cr) fc += `<div style="margin-top:7px">${cr}</div>`;

  let stx = rw('客观事实', s.fact);
  stx += rw('对他的意义', s.meaning);
  if (s.wound_touched) stx += rw('触及伤口', s.wound_touched);
  if (s.misread) stx += rw('可能的误读', s.misread);

  let em = rw('本能反应', e.instant);
  em += rw('真实情绪', e.true_feeling);
  em += rw('压下去的', e.suppressed);
  em += rw('漏出来的', e.leaked);
  if (e.shift) em += rw('段内变化', e.shift);

  let rc = rw('做什么', r.does);
  rc += rw('说什么', r.says);
  if (r.unspoken) rc += rw('没说的', r.unspoken);
  if (r.wants) rc += rw('真正想要', r.wants);
  if (r.fails_to) rc += rw('做不到', r.fails_to);

  let sy = '';
  if (arr(st.show).length) sy += rw('细节代替情绪词', st.show.join(' / '));
  if (st.sensory) sy += rw('感官锚点', st.sensory);
  if (st.pacing) sy += rw('节奏', st.pacing);
  if (st.dialogue_style) sy += rw('台词风格', st.dialogue_style);
  sy += chips(st.avoid, 'r');

  const body =
    '<div class="wrap">' +
    sec('人设解构', ch, '') +
    sec('信息边界', bd, 'g') +
    sec('焦点与戏份', fc, 'p') +
    sec('这一幕', stx, 'y') +
    sec('情绪层次', em, 'k') +
    `<div style="margin-top:10px;padding:9px 11px;border-radius:8px;background:rgba(255,255,255,.035)">${bar('强度闸门', level, icolor(level))}${rw('定档理由', d.intensity_why)}</div>` +
    sec('反应规划', rc, 'y') +
    sec('文笔', sy, 'g') +
    '<div class="foot">情感引擎 · 折叠卡片</div>' +
    '</div>';

  const summary =
    `<span class="ico"></span><span class="ttl">情感推演</span>` +
    `<span class="tag ${tagCls(level)}">强度 ${level}/10</span>` +
    (f.scene_focus ? `<span class="fc">焦点：${esc(f.scene_focus)}</span>` : '') +
    `<span class="ar">▾</span>`;

  return { summary, body, level };
}

function renderCardElement(draft, settings, degraded, doc) {
  const d = doc || hostDoc();
  if (!d) return null;
  const { summary, body } = buildCardParts(draft || {}, settings, degraded);
  const open = Boolean(settings?.cardOpen);
  const wrap = d.createElement('div');
  wrap.className = 'ee-card';
  wrap.setAttribute('data-ee-card', '1');
  wrap.innerHTML = `<details${open ? ' open' : ''}><summary>${summary}</summary>${body}</details>`;
  return wrap;
}

function findFloor(messageId, doc) {
  const d = doc || hostDoc();
  if (!d) return null;
  const $ = gHostJQuery();
  
  if (messageId !== undefined && messageId !== null && String(messageId) !== 'null') {
    const id = String(messageId);
    if ($) {
      const $el = $(`.mes[mesid="${id}"], .mes[data-mesid="${id}"], [mesid="${id}"]`, d);
      if ($el.length) return $el[0];
    }
    const idSels = [`.mes[mesid="${id}"]`, `[mesid="${id}"]`, `[data-mesid="${id}"]`];
    for (const s of idSels) {
      try { const el = d.querySelector(s); if (el) return el; } catch {}
    }
  } else {
    return findLastFloor(d);
  }
  return null;
}

function findLastFloor(doc) {
  const d = doc || hostDoc();
  if (!d) return null;
  const $ = gHostJQuery();
  if ($) {
    try {
      const $el = $('.mes', d).last();
      if ($el.length) return $el[0];
    } catch {}
  }
  const selectors = ['#chat .mes', '.mes', '#chat_log .mes'];
  for (const sel of selectors) {
    try {
      const list = d.querySelectorAll(sel);
      if (list && list.length) return list[list.length - 1];
    } catch {}
  }
  return null;
}



function insertionTarget(floor) {
  if (!floor) return null;
  const selectors = ['.mes_text', '.mes_block', '.chathistory_item_text', '.mes_container', '.message-content'];
  for (const sel of selectors) {
    try {
      const t = floor.querySelector(sel);
      if (t) return t;
    } catch {}
  }
  return floor;
}

function alreadyHasCard(floor) {
  if (!floor) return false;
  return !!floor.querySelector('[data-ee-card]');
}

function injectCardIntoFloor(messageId, draft, settings, degraded) {
  const d = hostDoc();
  if (!d) return { ok: false, reason: '无 document' };

  const floor = findFloor(messageId, d);
  if (!floor) return { ok: false, reason: '找不到消息楼层' };
  if (alreadyHasCard(floor)) return { ok: true, reason: '已有卡片' };

  ensureStyle(d);
  const cardEl = renderCardElement(draft, settings, degraded, d);
  if (!cardEl) return { ok: false, reason: '创建卡片失败' };

  const target = insertionTarget(floor);
  if (!target) return { ok: false, reason: '找不到插入位置' };

  try {
    const $ = gHostJQuery();
    if ($) {
      $(target).prepend(cardEl);
    } else {
      target.insertBefore(cardEl, target.firstChild);
    }
    return { ok: true, reason: '注入成功' };
  } catch (e) {
    return { ok: false, reason: 'DOM操作失败: ' + e.message };
  }
}

function docShell({ css, body, open }) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head>
<body${open ? ' class="op"' : ''}>${body}
<script>
(function(){
  function send(h){
    if(!h||h<1)return;
    try{
      parent.postMessage({type:'iframe-resize',height:h},'*');
      parent.postMessage({action:'resize',height:h},'*');
      parent.postMessage({eventType:'resize_iframe',height:h},'*');
    }catch(e){}
  }
  function cur(){return Math.ceil(document.documentElement.getBoundingClientRect().height);}
  send(cur());
  if(window.ResizeObserver){new ResizeObserver(function(){send(cur());}).observe(document.body);}
  else{setInterval(function(){send(cur());},400);}
  var d=document.querySelector('details');
  if(d)d.addEventListener('toggle',function(){setTimeout(function(){send(cur());},60);});
})();
</script></body></html>`;
}

function renderCard(draft, settings, degraded) {
  const { summary, body } = buildCardParts(draft || {}, settings, degraded);
  const open = Boolean(settings?.cardOpen);
  const html = docShell({
    css: CARD_CSS + '\nbody{margin:0;padding:0;background:transparent}',
    open,
    body: `<div class="ee-card"><details${open ? ' open' : ''}><summary>${summary}</summary>${body}</details></div>`,
  });
  return '```html\n' + html + '\n```';
}

function hasCard(text) {
  const t = String(text || '');
  return t.indexOf('情感推演') !== -1 && t.indexOf('```html') !== -1;
}

  return { renderCard, hasCard, renderCardElement, injectCardIntoFloor, findFloor, findLastFloor, ensureStyle, hostDoc, candidateDocs, envReport };
};


/* ============ ui.js ============ */
__defs['ui.js'] = function () {
/**
 * 玩家设置面板。
 * 定位：给玩家用的产品功能，不是开发者调试工具。
 *
 * 设计：
 *   - 右下角浮动按钮，可拖动，可关闭
 *   - 点击弹出完整设置面板
 *   - 现代极简风格，深色卡片 + 柔和描边
 */

const { loadSettings, saveSettings, resetSettings } = __req('config.js');
const { hostDoc } = __req('card.js');
const { fetchModels } = __req('planner.js');

const BTN_ID = 'ee-fab';
const PANEL_ID = 'ee-panel';
const BACKDROP_ID = 'ee-backdrop';
const STATUS_ID = 'ee-status';
const STYLE_ID = 'ee-ui-style';

let settingsRef = null;
let onChangeRef = null;
let testRef = null;
let statusTimer = null;

const PRESETS = {
  daily: {
    label: '日常向',
    desc: '平淡真实',
    icon: '☕',
    values: { intensityBias: -1, declutterLevel: 1, showCard: true, cardOpen: false },
  },
  standard: {
    label: '标准',
    desc: '推荐配置',
    icon: '◆',
    values: { intensityBias: 0, declutterLevel: 1, showCard: true, cardOpen: false },
  },
  intense: {
    label: '强戏剧',
    desc: '冲突密集',
    icon: '🔥',
    values: { intensityBias: 1, declutterLevel: 1, showCard: true, cardOpen: false },
  },
};

const CSS = `
:root {
  --ee-primary: #8b5cf6;
  --ee-primary-grad: linear-gradient(135deg, #6366f1, #8b5cf6);
  --ee-bg: #1e1e2e; /* 改为完全不透明的深色 */
  --ee-group-bg: #27273a;
  --ee-border: rgba(255, 255, 255, 0.15);
  --ee-text: #ffffff;
  --ee-text-dim: #a1a1aa;
  --ee-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
}

#ee-fab {
  position: fixed; left: 50%; bottom: 80px; z-index: 2000000;
  width: 64px; height: 64px; border-radius: 20px;
  transform: translateX(-50%);
  border: 2px solid #3f3f46; cursor: pointer;
  background: #1e1e2e; /* 实体背景 */
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  user-select: none; touch-action: none;
}
#ee-fab i { 
  background: var(--ee-primary-grad); -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  font-size: 28px; font-style: normal; font-weight: 800;
}

#ee-backdrop {
  position: fixed; inset: 0; z-index: 2000001;
  background: rgba(0, 0, 0, 0.85); /* 调深遮罩 */
  opacity: 0; pointer-events: none; transition: opacity 0.3s ease;
}
#ee-backdrop.ee-open { opacity: 1; pointer-events: auto; }

#ee-panel {
  position: fixed; top: 50%; left: 50%; z-index: 2000002;
  width: min(440px, 94vw); max-height: 90vh;
  background: var(--ee-bg); color: var(--ee-text);
  box-shadow: var(--ee-shadow);
  transform: translate(-50%, -48%) scale(0.95); opacity: 0;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--ee-border); border-radius: 24px;
  font-family: system-ui, -apple-system, sans-serif;
  pointer-events: none;
}
#ee-panel.ee-open { transform: translate(-50%, -50%) scale(1); opacity: 1; pointer-events: auto; }

/* 灵动岛样式状态条 - 完全不透明 */
#ee-status {
  position: fixed; left: 50%; top: 20px; transform: translateX(-50%) translateY(-30px); z-index: 3000000;
  background: #111111; color: #ffffff; border: 2px solid #8b5cf6;
  border-radius: 50px; padding: 12px 28px; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.9);
  opacity: 0; pointer-events: none; transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  display: flex; align-items: center; gap: 12px;
  width: max-content;
}
#ee-status.ee-show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* 启动闪屏 - 完全不透明 */
.ee-splash {
  position: fixed; inset: 0; z-index: 4000000; background: #000000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  transition: opacity 0.8s ease; pointer-events: none;
}
.ee-splash-logo {
  width: 110px; height: 110px; border-radius: 32px;
  background: var(--ee-primary-grad);
  display: flex; align-items: center; justify-content: center;
  font-size: 54px; color: white; margin-bottom: 30px;
  box-shadow: 0 0 80px rgba(99, 102, 241, 0.6);
}

.ee-card {
  margin: 12px 0; font-size: 13px; line-height: 1.6;
  color: #e2e8f0; contain: content;
  display: block !important; width: 100% !important;
}
.ee-card details {
  border-radius: 16px; background: #1a1a26;
  border: 1px solid #33334d; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
`;

function ensureCss() {
  const d = hostDoc();
  if (!d) return;
  if (d.getElementById(STYLE_ID)) return;
  const el = d.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (d.head || d.documentElement || d.body).appendChild(el);
}

function status(text, ms = 4000) {
  try {
    if (settingsRef && settingsRef.showStatus === false) return;
    const d = hostDoc() || document;
    let el = d.getElementById(STATUS_ID);
    if (!el) {
      ensureCss();
      el = d.createElement('div');
      el.id = STATUS_ID;
      (d.body || d.documentElement).appendChild(el);
    }
    el.innerHTML = `<span style="color:#8b5cf6;margin-right:8px;font-weight:bold;">✦</span>${text}`;
    el.classList.add('ee-show');
    
    // 强制实色显示，防止被主题覆盖
    el.style.backgroundColor = '#111111';
    el.style.color = '#ffffff';
    el.style.opacity = '1';
    el.style.border = '2px solid #8b5cf6';
    el.style.zIndex = '3000000';
    el.style.display = 'flex';
    
    clearTimeout(statusTimer);
    if (ms > 0) statusTimer = setTimeout(() => {
      el.classList.remove('ee-show');
    }, ms);
  } catch (e) {
    console.warn('[情感引擎] 状态显示失败：', e);
  }
}
function hideStatus() {
  const d = hostDoc() || document;
  const el = d.getElementById(STATUS_ID);
  if (el) { el.classList.remove('ee-show'); }
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sw(key, label, hint) {
  const on = settingsRef?.[key] !== false;
  return `<div class="ee-row"><div class="ee-row-l">${label}${hint ? `<small>${hint}</small>` : ''}</div><label class="ee-sw"><input type="checkbox" data-k="${key}" data-t="bool" ${on ? 'checked' : ''}><i></i></label></div>`;
}
function sel(key, label, options, hint) {
  const cur = settingsRef?.[key];
  const opts = options.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('');
  return `<label class="ee-lbl">${label}</label><select class="ee-inp" data-k="${key}">${opts}</select>${hint ? `<div class="ee-hint">${hint}</div>` : ''}`;
}
function txt(key, label, placeholder, hint, password) {
  const v = esc(settingsRef?.[key] ?? '');
  return `<label class="ee-lbl">${label}</label><input type="${password ? 'password' : 'text'}" class="ee-inp" data-k="${key}" value="${v}" placeholder="${esc(placeholder || '')}">${hint ? `<div class="ee-hint">${hint}</div>` : ''}`;
}
function area(key, label, placeholder, hint) {
  return `<label class="ee-lbl">${label}</label><textarea class="ee-inp" data-k="${key}" placeholder="${esc(placeholder || '')}">${esc(settingsRef?.[key] ?? '')}</textarea>${hint ? `<div class="ee-hint">${hint}</div>` : ''}`;
}

function presetCards() {
  const cur = settingsRef?.preset || 'standard';
  return Object.entries(PRESETS).map(([k, p]) =>
    `<div class="ee-preset ${cur === k ? 'on' : ''}" data-preset="${k}">
<i>${p.icon}</i><b>${p.label}</b><span>${p.desc}</span></div>`
  ).join('');
}

function stateBox() {
  const s = settingsRef || {};
  if (!s.enabled) return `<div class="ee-state warn">已关闭 —— 脚本不会介入任何生成。</div>`;
  const modeTxt = { off: '接管', rewrite: '重写', inject: '注入', manual: '手动' }[s.mode] || s.mode;
  let warn = '';
  if (s.mode === 'rewrite')
    warn = `<div class="ee-state warn">「重写」模式会多花一次生成。想省调用就在酒馆设置里关掉自动回复，改用「接管」模式。</div>`;
  return `<div class="ee-state">运行中 · ${esc(modeTxt)}模式 · 强度偏移 ${s.intensityBias > 0 ? '+' : ''}${s.intensityBias}${s.showCard ? ' · 卡片已开启' : ''}</div>${warn}`;
}

let fetchedModels = [];
let fetching = false;

function panelHtml() {
  const s = settingsRef || {};
  const bias = Number(s.intensityBias ?? 0);
  
  const modelOptions = fetchedModels.length > 0 
    ? fetchedModels.map(m => `<option value="${m}" ${s.plannerModel === m ? 'selected' : ''}>${m}</option>`).join('')
    : (s.plannerModel ? `<option value="${s.plannerModel}" selected>${s.plannerModel}</option>` : '<option value="">请先点击链接获取模型</option>');

  return `
<div class="ee-header">
  <div class="ee-header-title">
    <i>✦</i>
    <div>
      <h2>情感引擎</h2>
      <div style="font-size:11px;color:var(--ee-text-dim);margin-top:2px;">Emotion Engine Configuration</div>
    </div>
  </div>
  <button class="ee-close" data-act="close">✕</button>
</div>

<div class="ee-content">
  <div class="ee-section">
    <span class="ee-section-label">核心设定</span>
    <div class="ee-group">
      <div class="ee-presets">${presetCards()}</div>
      
      <div style="margin-top:8px;">
        <div class="ee-row-flex">
          <span class="ee-label">脚本总开关</span>
          <label class="ee-sw"><input type="checkbox" data-k="enabled" data-t="bool" ${s.enabled !== false ? 'checked' : ''}><i></i></label>
        </div>
      </div>
    </div>
  </div>

  <div class="ee-section">
    <span class="ee-section-label">推演 API 配置</span>
    <div class="ee-group">
      <div class="ee-row-flex">
        <span class="ee-label">启用独立 API</span>
        <label class="ee-sw"><input type="checkbox" data-k="useSeparateApi" data-t="bool" ${s.useSeparateApi ? 'checked' : ''}><i></i></label>
      </div>
      
      <div class="ee-input-wrap">
        <span class="ee-label">API 地址 (Base URL)</span>
        <input type="text" class="ee-input" data-k="plannerBase" value="${esc(s.plannerBase)}" placeholder="https://api.openai.com/v1">
      </div>
      
      <div class="ee-input-wrap">
        <span class="ee-label">API Key</span>
        <input type="password" class="ee-input" data-k="plannerKey" value="${esc(s.plannerKey)}" placeholder="sk-...">
      </div>

      <div class="ee-btn-row">
        <button class="ee-btn ee-btn-secondary" data-act="connect" ${fetching ? 'disabled' : ''}>
          ${fetching ? '连接中...' : '🔌 链接并获取模型'}
        </button>
      </div>

      <div class="ee-input-wrap">
        <span class="ee-label">推演模型 <span class="ee-model-tag">OpenAI Compatible</span></span>
        <select class="ee-input" data-k="plannerModel">
          ${modelOptions}
        </select>
      </div>
    </div>
  </div>

  <div class="ee-section">
    <span class="ee-section-label">情感表达微调</span>
    <div class="ee-group">
      <div class="ee-slider-top">
        <span class="ee-label">情感强度偏移</span>
        <span class="ee-slider-val" id="ee-bv">${bias > 0 ? '+' : ''}${bias}</span>
      </div>
      <input type="range" class="ee-range" data-k="intensityBias" data-t="num" min="-2" max="2" step="1" value="${bias}">
      <div class="ee-scale"><span>更收敛</span><span>默认</span><span>更强烈</span></div>
      
      <div style="margin-top:12px;" class="ee-input-wrap">
        <span class="ee-label">自定义禁用词</span>
        <input type="text" class="ee-input" data-k="customForbid" value="${esc(s.customForbid)}" placeholder="眸光,不由自主,仿佛...">
      </div>
    </div>
  </div>

  <div class="ee-section">
    <span class="ee-section-label">视觉与交互</span>
    <div class="ee-group">
      <div class="ee-row-flex">
        <span class="ee-label">显示推演卡片</span>
        <label class="ee-sw"><input type="checkbox" data-k="showCard" data-t="bool" ${s.showCard !== false ? 'checked' : ''}><i></i></label>
      </div>
      <div class="ee-row-flex">
        <span class="ee-label">卡片默认展开</span>
        <label class="ee-sw"><input type="checkbox" data-k="cardOpen" data-t="bool" ${s.cardOpen ? 'checked' : ''}><i></i></label>
      </div>
    </div>
  </div>
</div>

<div class="ee-footer">
  <button class="ee-btn ee-btn-primary" data-act="save">确认并保存</button>
  <button class="ee-btn ee-btn-secondary" data-act="reset">恢复默认</button>
</div>`;
}

function openPanel() {
  ensureCss();
  const d = hostDoc() || document;
  const p = d.getElementById(PANEL_ID);
  const bd = d.getElementById(BACKDROP_ID);
  if (p) p.classList.add('ee-open');
  if (bd) bd.classList.add('ee-open');
}

function closePanel() {
  const d = hostDoc() || document;
  const p = d.getElementById(PANEL_ID);
  const bd = d.getElementById(BACKDROP_ID);
  if (p) p.classList.remove('ee-open');
  if (bd) bd.classList.remove('ee-open');
}

function refresh() {
  const d = hostDoc() || document;
  const p = d.getElementById(PANEL_ID);
  if (!p) return;
  const scroll = p.scrollTop;
  p.innerHTML = panelHtml();
  p.scrollTop = scroll;
}

async function handleConnect() {
  const base = hostDoc().querySelector('[data-k="plannerBase"]')?.value;
  const key = hostDoc().querySelector('[data-k="plannerKey"]')?.value;
  
  if (!base) {
    status('❌ 请先填写 API 地址', 3000);
    return;
  }
  
  fetching = true;
  refresh();
  
  try {
    const models = await fetchModels({ base, key });
    if (models && models.length > 0) {
      fetchedModels = models;
      status(`✅ 成功获取 ${models.length} 个模型`, 3000);
    } else {
      throw new Error('未返回任何模型');
    }
  } catch (e) {
    console.error('[情感引擎] 链接失败：', e);
    status(`❌ 链接失败：${e.message}`, 5000);
  } finally {
    fetching = false;
    refresh();
  }
}

function collect() {
  const hd = hostDoc() || document;
  const panel = hd.getElementById(PANEL_ID);
  const next = { ...loadSettings() };
  if (!panel) return next;
  panel.querySelectorAll('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    const t = el.dataset.t;
    if (t === 'bool') next[k] = el.checked;
    else if (t === 'num') next[k] = Number(el.value);
    else next[k] = el.value;
  });
  return next;
}

function setupPanel() {
  ensureCss();
  const d = hostDoc() || document;

  // 遮罩
  if (!d.getElementById(BACKDROP_ID)) {
    const bd = d.createElement('div');
    bd.id = BACKDROP_ID;
    bd.className = 'ee-backdrop';
    bd.addEventListener('click', closePanel);
    (d.body || d.documentElement).appendChild(bd);
  }

  // 面板
  if (!d.getElementById(PANEL_ID)) {
    const p = d.createElement('div');
    p.id = PANEL_ID;
    p.innerHTML = panelHtml();
    (d.body || d.documentElement).appendChild(p);

    p.addEventListener('click', async (e) => {
      const preset = e.target.closest('[data-preset]');
      if (preset) {
        const key = preset.dataset.preset;
        const pv = PRESETS[key]?.values || {};
        const next = { ...collect(), preset: key, ...pv };
        settingsRef = next;
        refresh();
        status(`已预设为「${PRESETS[key].label}」模式`, 2000);
        return;
      }
      
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      
      if (act === 'close') { closePanel(); return; }
      if (act === 'connect') { await handleConnect(); return; }
      
      if (act === 'reset') {
        if (!confirm('确定要重置所有设置吗？')) return;
        settingsRef = resetSettings();
        if (onChangeRef) onChangeRef(settingsRef);
        refresh();
        status('设置已重置', 2000);
        return;
      }
      
      if (act === 'save') {
        settingsRef = saveSettings(collect());
        if (onChangeRef) onChangeRef(settingsRef);
        status('✅ 配置已安全保存至本地', 3000);
        closePanel();
        return;
      }
    });
    
    p.addEventListener('input', (e) => {
      if (e.target.matches('.ee-range')) {
        const v = Number(e.target.value);
        const out = p.querySelector('#ee-bv');
        if (out) out.textContent = (v > 0 ? '+' : '') + v;
      }
    });
  }
}

/* ---- 浮动按钮（可拖动） ---- */

function setupFab() {
  ensureCss();
  const d = hostDoc() || document;
  if (d.getElementById(BTN_ID)) return;

  const btn = d.createElement('button');
  btn.id = BTN_ID;
  btn.title = '情感引擎 · 配置';
  btn.textContent = '情';
  (d.body || d.documentElement).appendChild(btn);

  // 拖动逻辑
  let dragging = false, moved = false;
  let startX = 0, startY = 0, initialX = 0, initialY = 0;

  const onDown = (e) => {
    const pt = e.touches ? e.touches[0] : e;
    dragging = true; moved = false;
    startX = pt.clientX; startY = pt.clientY;
    const rect = btn.getBoundingClientRect();
    initialX = rect.left + rect.width / 2;
    initialY = rect.top + rect.height / 2;
    btn.classList.add('ee-dragging');
  };
  const onMove = (e) => {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
    
    const newX = initialX + dx;
    const newY = initialY + dy;
    btn.style.left = newX + 'px';
    btn.style.top = newY + 'px';
    btn.style.bottom = 'auto';
    btn.style.transform = 'translate(-50%, -50%)';
    try { e.preventDefault(); } catch {}
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    btn.classList.remove('ee-dragging');
    if (moved) {
      try {
        localStorage.setItem('ee:fab-pos', JSON.stringify({ left: btn.style.left, top: btn.style.top }));
      } catch {}
    }
  };

  btn.addEventListener('touchstart', onDown, { passive: true });
  btn.addEventListener('touchmove', onMove, { passive: false });
  btn.addEventListener('touchend', onUp);
  btn.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  // 恢复位置
  try {
    const pos = JSON.parse(localStorage.getItem('ee:fab-pos'));
    if (pos && pos.left && pos.top) {
      btn.style.left = pos.left;
      btn.style.top = pos.top;
      btn.style.bottom = 'auto';
      btn.style.transform = 'translate(-50%, -50%)';
    }
  } catch {}

  btn.addEventListener('click', (ev) => {
    if (moved) return;
    openPanel();
  });
}

function showSplash() {
  const d = hostDoc() || document;
  if (d.getElementById('ee-splash')) return;
  ensureCss();
  const el = d.createElement('div');
  el.id = 'ee-splash';
  el.className = 'ee-splash';
  el.innerHTML = `<div class="ee-splash-logo">✦</div><div class="ee-splash-t">情感引擎</div><div class="ee-splash-s">SillyTavern Emotion Engine</div>`;
  (d.body || d.documentElement).appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 600);
  }, 1800);
}

function setupMenuButton() {
  const d = hostDoc();
  const $ = gHostJQuery();
  if (!d || !$) return;

  const tryInsert = (retry = 0) => {
    const menu = d.querySelector('#extensionsMenu');
    if (!menu) {
      if (retry < 30) setTimeout(() => tryInsert(retry + 1), 1000);
      return;
    }

    if (d.getElementById('ee-menu-item')) return;

    const item = d.createElement('div');
    item.id = 'ee-menu-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.style.cssText = 'cursor:pointer; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; gap:10px;';
    item.innerHTML = `
      <div class="fa-fw fa-solid fa-brain" style="color:#8b5cf6;"></div>
      <span style="font-weight:bold;">情感引擎 (Emotion Engine)</span>
    `;
    item.addEventListener('click', () => {
      // 尝试关闭下拉菜单
      try { $(d.querySelector('#extensionsMenuButton')).trigger('click'); } catch(e) {}
      openPanel();
    });
    
    menu.prepend(item);
    console.log('[情感引擎] 成功集成至酒馆扩展菜单');
    status('✅ 已成功集成至扩展菜单', 2000);
  };

  tryInsert();
}

function mountUi(initialSettings, onChange, onManualRun, onTest) {
  settingsRef = initialSettings;
  onChangeRef = onChange;
  testRef = onTest;
  window.__ee_manual_run__ = onManualRun;

  const trySetup = (attempt = 0) => {
    const d = hostDoc();
    // 强制检查是否有特征元素，或者已经重试多次
    const hasTavern = d.querySelector('#chat') || d.querySelector('#chat_log');
    if (d && d.body && (hasTavern || attempt > 15)) {
      console.log('[情感引擎] 正在挂载 UI 至目标 Document...', d === document ? '当前窗口' : '顶层窗口');
      setupFab();
      setupPanel();
      setupMenuButton();
      return;
    }
    if (attempt < 30) setTimeout(() => trySetup(attempt + 1), 200);
    else console.warn('[情感引擎] UI 初始化失败');
  };
  trySetup();

  return { open: openPanel, close: closePanel, status, hideStatus };
}

function syncSettings(s) { settingsRef = s; }
function currentSettings() { return settingsRef; }

  return { PRESETS, status, hideStatus, mountUi, syncSettings, currentSettings, showSplash };
};


/* ============ planner.js ============ */
__defs['planner.js'] = function () {
/**
 * 第一次调用：人设解构 + 情绪推演。
 * 三条通道：generate / generateRaw / fetch。
 */
const { PLANNER_SYSTEM, buildPlannerUserPrompt } = __req('prompts.js');
const { normalizeBase } = __req('config.js');

function g(name) {
  const windows = [window];
  try { if (window.parent && window.parent !== window) windows.push(window.parent); } catch {}
  try { if (window.top && window.top !== window) windows.push(window.top); } catch {}
  
  for (const w of windows) {
    try {
      if (typeof w[name] === 'function') return w[name];
    } catch {}
  }
  return undefined;
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function extractJson(text) {
  if (!text) throw new Error('推演返回为空');
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('推演输出中找不到 JSON 对象');
  s = s.slice(start, end + 1);
  let fixed = s.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(fixed); } catch {
    try { return JSON.parse(s); } catch (e2) { throw new Error(`推演 JSON 解析失败：${e2.message}`); }
  }
}

function normalizeDraft(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    character: {
      archetype: String(d.character?.archetype ?? 'ordinary').toLowerCase(),
      surface: Array.isArray(d.character?.surface) ? d.character.surface : [],
      hidden: Array.isArray(d.character?.hidden) ? d.character.hidden : [],
      wound: String(d.character?.wound ?? ''),
      everyday: String(d.character?.everyday ?? ''),
      defense: String(d.character?.defense ?? ''),
      contradiction: Array.isArray(d.character?.contradiction) ? d.character.contradiction : [],
      tender: String(d.character?.tender ?? ''),
    },
    info_boundary: {
      observable: String(d.info_boundary?.observable ?? ''),
      internal: String(d.info_boundary?.internal ?? ''),
      leak_risk: String(d.info_boundary?.leak_risk ?? ''),
    },
    focus: {
      scene_focus: String(d.focus?.scene_focus ?? ''),
      user_weight: Number.isFinite(Number(d.focus?.user_weight)) ? Number(d.focus.user_weight) : 3,
      user_role: String(d.focus?.user_role ?? ''),
      cast: Array.isArray(d.focus?.cast) ? d.focus.cast : [],
    },
    situation: {
      fact: String(d.situation?.fact ?? ''),
      meaning: String(d.situation?.meaning ?? ''),
      wound_touched: String(d.situation?.wound_touched ?? ''),
      misread: String(d.situation?.misread ?? ''),
    },
    emotion: {
      instant: String(d.emotion?.instant ?? ''),
      true_feeling: String(d.emotion?.true_feeling ?? ''),
      suppressed: String(d.emotion?.suppressed ?? ''),
      leaked: String(d.emotion?.leaked ?? ''),
      shift: String(d.emotion?.shift ?? ''),
    },
    reaction: {
      does: String(d.reaction?.does ?? ''),
      says: String(d.reaction?.says ?? ''),
      unspoken: String(d.reaction?.unspoken ?? ''),
      wants: String(d.reaction?.wants ?? ''),
      fails_to: String(d.reaction?.fails_to ?? ''),
    },
    intensity: Number.isFinite(Number(d.intensity)) ? Number(d.intensity) : 3,
    intensity_why: String(d.intensity_why ?? ''),
    style: {
      show: Array.isArray(d.style?.show) ? d.style.show : [],
      avoid: Array.isArray(d.style?.avoid) ? d.style.avoid : [],
      sensory: String(d.style?.sensory ?? ''),
      pacing: String(d.style?.pacing ?? ''),
      dialogue_style: String(d.style?.dialogue_style ?? ''),
    },
  };
}

function tryGetCharacterCard() {
  const windows = [window];
  try { if (window.parent && window.parent !== window) windows.push(window.parent); } catch {}
  try { if (window.top && window.top !== window) windows.push(window.top); } catch {}

  const attempts = [
    (w) => (typeof w.SillyTavern !== 'undefined' && w.SillyTavern.getContext ? w.SillyTavern.getContext() : null),
    (w) => (w.SillyTavern && w.SillyTavern.getContext ? w.SillyTavern.getContext() : null),
    (w) => (w.TavernHelper && w.TavernHelper.getContext ? w.TavernHelper.getContext() : null),
    (w) => (typeof w.getContext === 'function' ? w.getContext() : null),
  ];

  for (const w of windows) {
    for (const fn of attempts) {
      try {
        const ctx = fn(w);
        if (!ctx) continue;
        const list = ctx.characters;
        const id = ctx.characterId ?? ctx.this_chid ?? (typeof w.this_chid !== 'undefined' ? w.this_chid : undefined);
        const ch = Array.isArray(list) ? list[id] : null;
        if (ch) {
          return {
            name: ch.name ?? ch.data?.name ?? '',
            description: ch.description ?? ch.data?.description ?? '',
            personality: ch.personality ?? ch.data?.personality ?? '',
            scenario: ch.scenario ?? ch.data?.scenario ?? '',
          };
        }
      } catch {}
    }
  }
  return null;
}

async function callViaTavernHelper(text, settings) {
  const generate = g('generate');
  const generateRaw = g('generateRaw');
  if (!generate && !generateRaw) throw new Error('未找到 generate / generateRaw，请确认酒馆助手已安装并启用');

  const common = {
    user_input: text,
    should_stream: false,
    should_silence: true,
    max_tokens: Number(settings.plannerMaxTokens) || 1400,
    temperature: Number(settings.plannerTemperature) || 0.45,
  };

  if (settings.useSeparateApi) {
    common.custom_api = {
      apiurl: normalizeBase(settings.plannerBase),
      key: settings.plannerKey || '',
      model: settings.plannerModel || '',
    };
  }

  if (settings.plannerChannel === 'generateRaw' && generateRaw) {
    try {
      return await generateRaw({
        ...common,
        ordered_prompts: ['char_description', 'chat_history', 'user_input'],
      });
    } catch (e) {
      console.warn('[情感引擎] generateRaw 失败，降级为 generate：', e);
    }
  }

  return await generate(common);
}

async function openaiChat({ base, key, model, messages, temperature, maxTokens }) {
  const url = `${normalizeBase(base)}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model, messages, stream: false,
      temperature: Number(temperature) || 0.45,
      max_tokens: Number(maxTokens) || 1400,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`推演请求失败 ${res.status}：${String(body).slice(0, 300)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('推演返回结构异常');
  return content;
}

async function callViaFetch(text, settings) {
  const card = tryGetCharacterCard();
  const getChatMessages = g('getChatMessages');

  let history = '';
  try {
    if (getChatMessages) {
      const msgs = getChatMessages(-8, { include_swipes: false }) || [];
      history = (Array.isArray(msgs) ? msgs : [])
        .map((m) => `${m?.role === 'user' ? '用户' : m?.name || '角色'}：${m?.message ?? ''}`)
        .join('\n');
    }
  } catch { history = ''; }

  const cardBlock = card ? [
    `【角色名】${card.name}`,
    card.description ? `【角色描述】${card.description}` : '',
    card.personality ? `【性格】${card.personality}` : '',
    card.scenario ? `【场景】${card.scenario}` : '',
  ].filter(Boolean).join('\n') : '（未能自动读取角色卡）';

  return await openaiChat({
    base: settings.plannerBase,
    key: settings.plannerKey,
    model: settings.plannerModel,
    temperature: settings.plannerTemperature,
    maxTokens: settings.plannerMaxTokens,
    messages: [
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user', content: `${cardBlock}\n\n${history ? `【最近聊天】\n${history}\n\n` : ''}${text}` },
    ],
  });
}

async function runPlanner(ctx, settings) {
  const text = buildPlannerUserPrompt({
    userInput: ctx.userInput,
    recentChat: ctx.recentChat || '',
    intensityBias: Number(settings.intensityBias) || 0,
    extraNote: settings.extraNote || '',
  });

  const fullText = `${PLANNER_SYSTEM}\n\n${text}`;

  let raw;
  if (settings.plannerChannel === 'fetch') {
    raw = await withTimeout(callViaFetch(text, settings), settings.plannerTimeout, '推演');
  } else {
    raw = await withTimeout(callViaTavernHelper(fullText, settings), settings.plannerTimeout, '推演');
  }

  const rawText = typeof raw === 'string' ? raw : raw?.content ?? '';
  const draft = normalizeDraft(extractJson(rawText));
  return { draft, raw: rawText };
}

async function fetchModels({ base, key }) {
  const url = `${normalizeBase(base)}/models`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`获取模型失败 ${res.status}：${String(body).slice(0, 100)}`);
  }
  const json = await res.json();
  return (json?.data || []).map(m => typeof m === 'string' ? m : m.id).filter(Boolean);
}

  return { extractJson, normalizeDraft, openaiChat, runPlanner, fetchModels };
};


/* ============ index.js ============ */
__defs['index.js'] = function () {
/**
 * 主入口。
 * ① 用户发消息 → ② 推演（静默）→ ③ 编译约束 → ④ 正式生成 → ⑤ 卡片插入
 */
const { loadSettings, validateApi, normalizeBase } = __req('config.js');
const { runPlanner } = __req('planner.js');
const { compileDirectives, fallbackDirectives } = __req('prompts.js');
const { renderCard, hasCard, injectCardIntoFloor, ensureStyle, hostDoc, envReport } = __req('card.js');
const { mountUi, syncSettings, status, hideStatus, showSplash } = __req('ui.js');

const NS = 'ee';
const DRAFT_VAR = 'ee.draft';

let settings = loadSettings();
let runId = 0;
let busy = false;

function g(name) {
  const windows = [window];
  try { if (window.parent && window.parent !== window) windows.push(window.parent); } catch {}
  try { if (window.top && window.top !== window) windows.push(window.top); } catch {}
  
  for (const w of windows) {
    try {
      if (typeof w[name] === 'function') return w[name];
    } catch {}
  }
  return undefined;
}

function ev(name, fallback) {
  const windows = [window];
  try { if (window.parent && window.parent !== window) windows.push(window.parent); } catch {}
  try { if (window.top && window.top !== window) windows.push(window.top); } catch {}
  
  for (const w of windows) {
    try {
      const obj = w.tavern_events || w.iframe_events;
      if (obj && obj[name]) return obj[name];
    } catch {}
  }
  return fallback;
}

const EVENTS = {
  MESSAGE_RECEIVED: ev('MESSAGE_RECEIVED', 'message_received'),
  GENERATION_ENDED: ev('GENERATION_ENDED', 'generation_ended'),
  CHAT_CHANGED: ev('CHAT_CHANGED', 'chat_changed'),
};

function readMessages(range, opts) {
  const f = g('getChatMessages');
  if (!f) return [];
  for (const r of [range, -1, 'last']) {
    try {
      const res = f(r, opts || {});
      if (Array.isArray(res)) return res;
      if (res && typeof res === 'object') return [res];
    } catch {}
  }
  return [];
}

function getLastUserMessage() {
  const direct = readMessages('last', { role: 'user', include_swipes: false });
  if (direct.length && direct[0]?.role === 'user') return direct[0];
  const all = readMessages(-8, { include_swipes: false });
  for (let i = all.length - 1; i >= 0; i--) if (all[i]?.role === 'user') return all[i];
  return null;
}

function getLastMessage() {
  const direct = readMessages('last', { include_swipes: false });
  if (direct.length) return direct[0];
  const all = readMessages(-3, { include_swipes: false });
  return all.length ? all[all.length - 1] : null;
}

function buildRecentChat(n = 8) {
  const all = readMessages(-n, { include_swipes: false });
  return (all || []).map((m) =>
    `${m?.role === 'user' ? '用户' : m?.name || '角色'}：${String(m?.message ?? '').slice(0, 600)}`
  ).join('\n');
}

async function saveDraftVariable(text) {
  const setV = g('setVariable');
  if (setV) { try { await setV(DRAFT_VAR, text, { type: 'chat' }); return true; } catch {} }
  const uv = g('updateVariablesWith');
  if (uv) { try { await uv(() => text, { type: 'chat' }); return true; } catch {} }
  return false;
}

async function logDraft(text) {
  if (!settings.keepDraftLog) return;
  const create = g('createChatMessages');
  if (!create) return;
  try {
    await create([{ role: 'system', message: text, is_hidden: true, data: { 'ee:draft': true } }], {
      insert_before: 'end', refresh: 'none',
    });
  } catch {}
}

async function generateFinal(directives) {
  const generate = g('generate');
  if (!generate) throw new Error('未找到 generate()，请确认酒馆助手已安装并启用');

  const injectPrompt = {
    id: `${NS}:directives`,
    position: 'in_chat',
    depth: 1,
    role: 'system',
    content: directives,
  };

  const baseOpts = { should_stream: true };

  if (settings.finalUseSeparateApi && settings.finalBase && settings.finalModel) {
    baseOpts.custom_api = {
      apiurl: normalizeBase(settings.finalBase),
      key: settings.finalKey || '',
      model: settings.finalModel,
    };
  }

  const injectPrompts = g('injectPrompts');
  if (injectPrompts) {
    let uninject = null;
    try { uninject = injectPrompts([injectPrompt])?.uninject; } catch { uninject = null; }
    try { return await generate(baseOpts); }
    finally { if (typeof uninject === 'function') { try { uninject(); } catch {} } }
  }

  return await generate({ ...baseOpts, injects: [injectPrompt] });
}

const _draftCache = new Map();

async function storeDraft(messageId, draft, degraded) {
  if (messageId !== undefined && messageId !== null) {
    _draftCache.set(String(messageId), { draft, degraded: !!degraded });
  }
  const setMsgs = g('setChatMessages');
  if (!setMsgs || messageId === undefined || messageId === null) return false;
  try {
    await setMsgs(
      [{ message_id: messageId, extra: { ee_draft: draft, ee_degraded: !!degraded, ee_v: 1 } }],
      { refresh: 'none' }
    );
    return true;
  } catch (e) {
    console.warn('[情感引擎] 存储推演失败：', e);
    return false;
  }
}

async function writeCardBlock(messageId, cardHtml) {
  const setMsgs = g('setChatMessages');
  const create = g('createChatMessages');
  const del = g('deleteChatMessages');
  if (!messageId && messageId !== 0) return false;

  const msg = readMessages(-3, { include_swipes: false }).find(
    (m) => Number(m?.message_id) === Number(messageId)
  );
  const text = String(msg?.message ?? '');
  if (hasCard(text)) return false;

  if (setMsgs) {
    try {
      await setMsgs([{ message_id: messageId, mes: cardHtml + '\n\n' + text }], { refresh: 'affected' });
      return true;
    } catch {}
  }
  if (del && create) {
    try {
      await del([messageId], { refresh: 'none' });
      await create([{ role: 'assistant', message: cardHtml + '\n\n' + text }], {
        insert_before: 'end', refresh: 'affected',
      });
      return true;
    } catch {}
  }
  return false;
}

async function prependCard(draft, degraded, messageId) {
  if (!settings.showCard) return false;
  if (messageId === undefined || messageId === null) return false;

  ensureStyle();
  await storeDraft(messageId, draft, degraded);

  const mode = settings.cardMode || 'dom';

  if (mode === 'dom') {
    let lastReason = '';
    for (let i = 0; i < 15; i++) {
      const r = injectCardIntoFloor(messageId, draft, settings, degraded);
      if (r && r.ok) return true;
      lastReason = (r && r.reason) || '';
      await sleep(300);
    }
    console.warn('[情感引擎] DOM 注入失败：', lastReason, '| 环境：', envReport());
    status(`卡片注入失败（${lastReason}），已退回代码块`, 5000);
  }

  return await writeCardBlock(messageId, renderCard(draft, settings, degraded));
}

async function restoreCards() {
  if (!settings.showCard) return 0;
  const d = hostDoc();
  if (!d) return 0;
  const $ = gHostJQuery();
  ensureStyle(d);

  const jobs = [];
  try {
    // 强制从酒馆现有的楼层里找需要补录的
    const allMes = d.querySelectorAll('.mes');
    for (const m of allMes) {
      const mesId = m.getAttribute('mesid') || m.getAttribute('data-mesid');
      if (!mesId) continue;
      
      // 检查是否已有卡片，如果没有但 extra 里有数据，则加入任务
      if (!m.querySelector('[data-ee-card]')) {
        // 尝试从本地缓存中恢复
        if (_draftCache.has(String(mesId))) {
          const rec = _draftCache.get(String(mesId));
          jobs.push({ id: mesId, draft: rec.draft, degraded: rec.degraded });
        }
      }
    }
  } catch (e) {}

  let n = 0;
  for (const j of jobs) {
    const r = injectCardIntoFloor(j.id, j.draft, settings, j.degraded);
    if (r && r.ok) n++;
  }
  return n;
}

let _guard = null;
let _guardTimer = null;

function startGuard() {
  if (_guard) return;
  const d = hostDoc();
  if (!d) return;

  // 手机端终极守护：双轨制巡检 (MutationObserver + 轮询)
  const runRestore = () => {
    if (!settings.enabled || !settings.showCard) return;
    restoreCards();
  };

  // 1. 挂载 DOM 变动监听
  try {
    const dv = d.defaultView || window;
    const MO = dv.MutationObserver || window.MutationObserver;
    if (MO) {
      let target = d.querySelector('#chat') || d.querySelector('#chat_log') || d.body;
      _guard = new MO(() => {
        clearTimeout(_guardTimer);
        _guardTimer = setTimeout(runRestore, 600);
      });
      _guard.observe(target, { childList: true, subtree: true });
    }
  } catch (e) {}

  // 2. 挂载高频轮询 (防止滑动时 DOM 回收导致美化消失)
  setInterval(runRestore, 1500);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitFor(evtName, timeoutMs) {
  const eventOn = g('eventOn');
  if (!eventOn) return Promise.resolve(false);
  return new Promise((resolve) => {
    let off = null;
    const timer = setTimeout(() => {
      if (off && off.stop) off.stop();
      resolve(false);
    }, timeoutMs);
    try {
      const h = eventOn(evtName, () => {
        clearTimeout(timer);
        if (h && h.stop) h.stop();
        resolve(true);
      });
      off = h;
    } catch { clearTimeout(timer); resolve(false); }
  });
}

async function stripNativeReply(baselineId) {
  const del = g('deleteChatMessages');
  if (!del) return;
  const all = readMessages(-6, { include_swipes: false });
  const ids = (all || [])
    .filter((m) => m && m.role === 'assistant' && Number(m.message_id) > Number(baselineId))
    .map((m) => m.message_id);
  if (!ids.length) return;
  try { await del(ids, { refresh: 'affected' }); } catch {}
}

async function run(trigger) {
  if (!settings.enabled) return;
  if (busy) { status('⏳ 上一次推演尚未结束', 2000); return; }
  const myRun = ++runId;
  busy = true;

  try {
    status('🔍 情感引擎：开始处理消息...', 3000);
    const check = validateApi(settings);
    if (!check.ok) { status('⚠️ ' + check.message, 5000); return; }

    const userMsg = getLastUserMessage();
    if (!userMsg || !userMsg.message) { status('❌ 没读到用户消息', 3000); return; }

    const baselineId = Number(userMsg.message_id ?? -1);
    status('① 正在分析人设与信息边界...', 0);

    let draft = null;
    let degraded = false;
    let directives;

    try {
      const res = await runPlanner(
        { userInput: String(userMsg.message), recentChat: buildRecentChat(8) },
        settings
      );
      draft = res.draft;
      directives = compileDirectives(draft, settings);
      status('✅ 分析完成，正在执行生成...', 0);
    } catch (e) {
      console.warn('[情感引擎] 推演失败，降级：', e);
      degraded = true;
      directives = fallbackDirectives(settings);
      status(`⚠️ 分析异常(已降级)：${String(e.message || e).slice(0, 50)}`, 4000);
    }

    if (myRun !== runId) return;

    if (settings.mode === 'inject') {
      await saveDraftVariable(directives);
      await logDraft(directives);
      status('📦 推演已存入变量', 4000);
      return;
    }

    if (settings.mode === 'rewrite' && trigger === 'auto') {
      status('⌛ 等待原生回复结束...', 0);
      const ended = await waitFor(EVENTS.GENERATION_ENDED, 120000);
      if (!ended) { status('❌ 等待原生生成超时', 4000); return; }
      if (myRun !== runId) return;
      await stripNativeReply(baselineId);
    }

    if (myRun !== runId) return;

    status('② 正在生成受约束的回复...', 0);
    const before = getLastMessage();
    const beforeId = Number(before?.message_id ?? -1);

    const result = await generateFinal(directives);
    const text = typeof result === 'string' ? result : result?.content ?? '';

    if (myRun !== runId) return;

    const after = getLastMessage();
    const afterId = Number(after?.message_id ?? -1);
    const autoWritten = afterId > beforeId && after?.role === 'assistant';

    if (!autoWritten && text) {
      const create = g('createChatMessages');
      if (create) {
        try {
          await create([{ role: 'assistant', message: text, is_hidden: false }], {
            insert_before: 'end', refresh: 'affected',
          });
        } catch {}
      }
    }

    const finalMsg = getLastMessage();
    const targetId = finalMsg && finalMsg.role === 'assistant'
      ? finalMsg.message_id
      : Number(after?.message_id ?? beforeId);

    if (targetId !== undefined && targetId !== null && Number(targetId) > -1) {
      status('③ 正在注入美化卡片...', 0);
      await sleep(600);
      await prependCard(draft, degraded, targetId);
      status('✨ 任务完成：回复已美化', 3500);
    }

    if (draft && settings.keepDraftLog) await logDraft(JSON.stringify(draft, null, 2));
  } catch (e) {
    console.error('[情感引擎]', e);
    status(`❌ 引擎出错：${String(e.message || e).slice(0, 100)}`, 6000);
  } finally {
    if (myRun === runId) busy = false;
  }
}

function notify(msg, type) {
  try {
    if (typeof toastr !== 'undefined' && toastr[type]) { toastr[type](msg); return; }
  } catch {}
  console.log(`[情感引擎] ${msg}`);
}

function diagnose() {
  const d = hostDoc();
  let floors = -1;
  try { floors = d ? d.querySelectorAll('.mes').length : -1; } catch {}

  const sample = {
    character: {
      archetype: 'ordinary',
      surface: ['温和', '爱吐槽'],
      everyday: '口头禅"行吧"，紧张时会整理桌上的东西',
      hidden: ['怕被人觉得没用'],
      contradiction: ['嘴上说随便其实最在意'],
    },
    info_boundary: {
      observable: '他坐下，说了句"今天挺累的"',
      internal: '因为上次被当众否定，所以害怕再开口',
      leak_risk: '角色可能忍不住安慰 —— 这是穿帮',
    },
    focus: {
      scene_focus: '傍晚的店里',
      user_weight: 3,
      cast: [
        { name: '阿哲', weight: 8, note: '刚打碎杯子' },
        { name: '林晚', weight: 2, note: '在里屋' },
      ],
    },
    situation: { fact: '打碎了一个杯子', meaning: '他刚被说过毛手毛脚' },
    emotion: { instant: '手停在半空', true_feeling: '怕被念叨' },
    reaction: { does: '蹲下捡碎片', says: '我赔。' },
    intensity: 2,
    intensity_why: '打碎杯子是小事，升到 4 会小题大做',
    style: { show: ['捡碎片时手指停顿'], avoid: ['瞳孔一缩'] },
  };

  const r = injectCardIntoFloor(null, sample, settings, false);
  const msg = `环境：${envReport()}\n楼层数：${floors}\n卡片模式：${settings.cardMode || 'dom'}\n注入：${r.ok ? '成功' : '失败'}（${r.reason}）`;
  console.log('[情感引擎] 诊断\n' + msg);
  notify(msg.replace(/\n/g, ' | '), r.ok ? 'success' : 'error');
}

function boot() {
  showSplash();
  settings = loadSettings();
  syncSettings(settings);

  mountUi(
    settings,
    (next) => { settings = next; syncSettings(settings); },
    () => run('manual'),
    () => diagnose()
  );

  const setupEvents = (attempt = 0) => {
    const eventOn = g('eventOn');
    if (eventOn) {
      const triggerRun = (messageId, type) => {
        if (!settings.enabled || settings.mode === 'manual') return;
        // 排除掉非用户触发的干扰
        if (typeof type === 'string' && ['command', 'extension', 'impersonate'].includes(type)) return;
        console.log('[情感引擎] 捕获到消息触发点:', type);
        setTimeout(() => run('auto'), 0);
      };

      try {
        // 多重监听保障：message_received, character_message_received, generation_started
        eventOn(EVENTS.MESSAGE_RECEIVED, triggerRun);
        eventOn('character_message_received', triggerRun);
        eventOn('generation_started', () => {
           console.log('[情感引擎] 监听到生成开始');
        });
      } catch (e) { console.warn('[情感引擎] 事件注册异常：', e); }

      for (const evt of [EVENTS.CHAT_CHANGED, EVENTS.GENERATION_ENDED, 'swiped']) {
        try {
          eventOn(evt, () => {
            if (!settings.showCard) return;
            setTimeout(() => restoreCards(), 300);
          });
        } catch {}
      }
      const msg = '✅ 系统监听就绪';
      console.log('[情感引擎] ' + msg);
      status(msg, 2000);
    } else if (attempt < 30) {
      setTimeout(() => setupEvents(attempt + 1), 500);
    } else {
      const msg = '⚠️ 未能绑定官方事件';
      console.warn('[情感引擎] ' + msg);
      status(msg, 5000);
    }
  };

  setupEvents();
  setTimeout(() => restoreCards(), 700);
  setTimeout(() => startGuard(), 900);

  setTimeout(() => {
    const d = hostDoc();
    let floors = -1;
    try { floors = d ? d.querySelectorAll('.mes').length : -1; } catch {}
    const report = envReport();
    const modeTxt = settings.mode;
    const cardMode = settings.cardMode || 'dom';
    
    const bootMsg = `[情感引擎] 已启动 · 模式：${modeTxt} · 卡片：${cardMode}`;
    const diagMsg = `[情感引擎] 自检 · ${report} 楼层=${floors} 卡片=${cardMode}`;
    
    console.log(bootMsg);
    console.log(diagMsg);
    
    // 依次显示状态，确保手机端能看到
    status(bootMsg, 4000);
    setTimeout(() => status(diagMsg, 5000), 4200);

    if (floors === 0) console.warn('[情感引擎] 主页面上没找到 .mes 楼层，可能聊天尚未加载。');
  }, 1200);
}

function ready(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

ready(() => setTimeout(boot, 300));

  return { run, loadSettings };
};


/* ---- 启动入口 ---- */
try {
  __req('index.js');
} catch (e) {
  const errMsg = '[情感引擎] 启动失败: ' + (e && e.message || e);
  console.error(errMsg, e);
  try {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:5px;left:5px;right:5px;z-index:999999;background:#b00;color:white;padding:12px;font-size:13px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.5);text-align:center;';
    div.textContent = errMsg;
    (document.body || document.documentElement).appendChild(div);
    setTimeout(() => div.remove(), 8000);
  } catch(_) {}
}
})();
