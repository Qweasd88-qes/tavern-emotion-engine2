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
  if (_hostDocCache) {
    try { if (_hostDocCache.body) return _hostDocCache; } catch { _hostDocCache = null; }
  }

  let current = window;
  let outermostDoc = document;

  // 向上探测最外层可访问的 document
  while (current) {
    try {
      if (current.document && current.document.body) {
        outermostDoc = current.document;
      }
      if (current.parent === current || !current.parent) break;
      current = current.parent;
    } catch (e) {
      break; // 跨域限制，停止探测
    }
  }

  // 进一步验证是否包含酒馆关键元素
  try {
    if (outermostDoc.querySelector('#chat') || outermostDoc.querySelector('.mes') || outermostDoc.querySelector('#chat_log')) {
      _hostDocCache = outermostDoc;
      return outermostDoc;
    }
  } catch (e) {}

  // 如果最外层没找到（可能在某些特殊的嵌入环境下），尝试在所有层级找一遍
  const docs = [document];
  try { if (window.parent && window.parent !== window) docs.push(window.parent.document); } catch {}
  try { if (window.top && window.top !== window) docs.push(window.top.document); } catch {}

  for (const d of docs) {
    try {
      if (d && (d.querySelector('#chat') || d.querySelector('.mes') || d.querySelector('#chat_log'))) {
        _hostDocCache = d;
        return d;
      }
    } catch {}
  }

  return outermostDoc;
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
  if (messageId !== undefined && messageId !== null) {
    const id = String(messageId);
    const sels = [
      `#chat .mes[mesid="${id}"]`,
      `.mes[mesid="${id}"]`,
      `[mesid="${id}"]`,
      `.mes[data-mesid="${id}"]`,
      `[data-mesid="${id}"]`,
    ];
    for (const s of sels) {
      try { const el = d.querySelector(s); if (el) return el; } catch {}
    }
  }
  return null;
}

function findLastFloor(doc) {
  const d = doc || hostDoc();
  if (!d) return null;
  for (const sel of ['#chat .mes', '.mes', '#chat_log .mes']) {
    try {
      const list = d.querySelectorAll(sel);
      if (list && list.length) return list[list.length - 1];
    } catch {}
  }
  return null;
}

function insertionTarget(floor) {
  if (!floor) return null;
  // 增加更多 SillyTavern 可能的容器选择器
  const selectors = [
    '.mes_text', 
    '.mes_block', 
    '.chathistory_item_text', 
    '.mes_container',
    '.message-content'
  ];
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
  try { return Boolean(floor.querySelector('[data-ee-card]')); } catch { return false; }
}

function injectCardIntoFloor(messageId, draft, settings, degraded) {
  const d = hostDoc();
  if (!d) return { ok: false, reason: '拿不到页面 document' };

  let floor = findFloor(messageId, d);
  let usedFallback = false;
  if (!floor) { floor = findLastFloor(d); usedFallback = true; }
  if (!floor) return { ok: false, reason: '页面上找不到任何楼层' };
  if (alreadyHasCard(floor)) return { ok: true, reason: '已有卡片' };

  ensureStyle(d);
  const el = renderCardElement(draft, settings, degraded, d);
  if (!el) return { ok: false, reason: '创建卡片元素失败' };

  const target = insertionTarget(floor);
  if (!target) return { ok: false, reason: '找不到插入位置' };

  try {
    if (target.firstChild) target.insertBefore(el, target.firstChild);
    else target.appendChild(el);
    return { ok: true, reason: usedFallback ? '已插入（用了兜底楼层）' : '已插入' };
  } catch (e) {
    return { ok: false, reason: '插入失败：' + String(e && e.message) };
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

const BTN_ID = 'ee-fab';
const PANEL_ID = 'ee-panel';
const BACKDROP_ID = 'ee-backdrop';
const STATUS_ID = 'ee-status';
const STYLE_ID = 'ee-ui-style';

let settingsRef = null;
let onChangeRef = null;
let testRef = null;

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
#ee-fab{position:fixed;right:20px;bottom:20px;z-index:99998;width:50px;height:50px;border-radius:16px;
border:none;cursor:pointer;background:linear-gradient(145deg,#6b7cff,#8b5cf6);color:#fff;font-size:19px;
box-shadow:0 6px 24px rgba(107,124,255,.45);display:flex;align-items:center;justify-content:center;
opacity:.92;transition:transform .2s,opacity .2s,box-shadow .2s;font-weight:600;
-webkit-tap-highlight-color:transparent;user-select:none}
#ee-fab:hover{opacity:1;transform:translateY(-3px) scale(1.03);box-shadow:0 10px 28px rgba(107,124,255,.6)}
#ee-fab:active{transform:translateY(-1px) scale(.98)}
#ee-fab.ee-dragging{cursor:grabbing;transition:none}

#ee-backdrop{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.5);
backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
opacity:0;pointer-events:none;transition:opacity .25s}
#ee-backdrop.ee-open{opacity:1;pointer-events:auto}

#ee-panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,94vw);z-index:99999;
background:linear-gradient(180deg,#1c1c26 0%,#141419 100%);color:#e6e6f0;
overflow-y:auto;padding:0 0 24px;box-shadow:-12px 0 40px rgba(0,0,0,.6);
font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
transform:translateX(102%);transition:transform .3s cubic-bezier(.4,0,.2,1);
overscroll-behavior:contain}
#ee-panel.ee-open{transform:translateX(0)}
#ee-panel::-webkit-scrollbar{width:6px}
#ee-panel::-webkit-scrollbar-track{background:transparent}
#ee-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}
#ee-panel::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.2)}

.ee-head{position:sticky;top:0;z-index:3;padding:18px 20px 14px;
background:linear-gradient(180deg,#232330 0%,#1c1c26 100%);
border-bottom:1px solid rgba(255,255,255,.06)}
.ee-head-row{display:flex;align-items:center;gap:10px}
.ee-logo{width:32px;height:32px;border-radius:10px;background:linear-gradient(145deg,#6b7cff,#8b5cf6);
display:flex;align-items:center;justify-content:center;font-size:16px;flex:none;
box-shadow:0 3px 10px rgba(107,124,255,.4)}
.ee-title{font-size:15.5px;font-weight:600;color:#f0f0f8;letter-spacing:.2px;flex:1}
.ee-close{width:32px;height:32px;border-radius:8px;border:none;background:rgba(255,255,255,.06);
color:#b0b0c4;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
transition:background .15s,color .15s;flex:none;-webkit-tap-highlight-color:transparent}
.ee-close:hover{background:rgba(255,255,255,.12);color:#fff}
.ee-sub{font-size:11.5px;color:#84849c;margin-top:8px;line-height:1.55}

.ee-body{padding:16px 20px 0}
.ee-sec{margin-bottom:18px}
.ee-sec-t{font-size:10.5px;font-weight:600;color:#8b9cff;letter-spacing:1.2px;margin-bottom:10px;
text-transform:uppercase}

.ee-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
.ee-preset{padding:12px 8px;border-radius:12px;background:rgba(255,255,255,.04);
border:1.5px solid rgba(255,255,255,.06);cursor:pointer;text-align:center;
transition:all .18s;-webkit-tap-highlight-color:transparent}
.ee-preset:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.12)}
.ee-preset.on{border-color:#6b7cff;background:rgba(107,124,255,.12);
box-shadow:0 0 0 3px rgba(107,124,255,.12)}
.ee-preset i{font-style:normal;font-size:20px;display:block;margin-bottom:4px}
.ee-preset b{font-size:12px;font-weight:600;color:#e6e6f0;display:block}
.ee-preset span{font-size:10px;color:#7f7f96;line-height:1.35;display:block;margin-top:3px}

.ee-card{padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.035);
border:1px solid rgba(255,255,255,.05)}
.ee-slider-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.ee-slider-top b{font-size:12.5px;color:#dcdcea;font-weight:500}
.ee-slider-val{font-size:11.5px;color:#8b9cff;background:rgba(139,156,255,.14);
padding:2px 10px;border-radius:8px;font-weight:500;min-width:32px;text-align:center}
.ee-range{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:3px;
background:rgba(255,255,255,.1);outline:none;cursor:pointer}
.ee-range::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;
background:linear-gradient(145deg,#6b7cff,#8b5cf6);cursor:pointer;
box-shadow:0 2px 8px rgba(107,124,255,.55);border:2px solid #fff;box-sizing:border-box}
.ee-range::-moz-range-thumb{width:18px;height:18px;border:2px solid #fff;border-radius:50%;
background:#6b7cff;cursor:pointer;box-sizing:border-box}
.ee-scale{display:flex;justify-content:space-between;font-size:10px;color:#6e6e86;margin-top:6px}

.ee-row{display:flex;align-items:center;justify-content:space-between;gap:12px;
padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.035);margin-bottom:7px;
border:1px solid rgba(255,255,255,.04)}
.ee-row-l{font-size:12.5px;color:#d4d4e4;flex:1;line-height:1.4}
.ee-row-l small{display:block;font-size:10.5px;color:#77778e;margin-top:2px;line-height:1.4}
.ee-sw{position:relative;width:42px;height:24px;flex:none}
.ee-sw input{opacity:0;width:0;height:0;position:absolute}
.ee-sw i{position:absolute;inset:0;border-radius:12px;background:rgba(255,255,255,.14);
cursor:pointer;transition:.2s}
.ee-sw i::before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;
border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.ee-sw input:checked + i{background:linear-gradient(145deg,#6b7cff,#8b5cf6)}
.ee-sw input:checked + i::before{transform:translateX(18px)}

.ee-lbl{font-size:12px;color:#b8b8cc;margin:12px 0 6px;display:block}
.ee-inp{width:100%;box-sizing:border-box;background:rgba(0,0,0,.3);color:#e6e6f0;
border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:9px 12px;font-size:12.5px;
font-family:inherit;outline:none;transition:.16s;line-height:1.5}
.ee-inp:focus{border-color:#6b7cff;background:rgba(0,0,0,.42);
box-shadow:0 0 0 3px rgba(107,124,255,.14)}
.ee-inp::placeholder{color:#5e5e76}
textarea.ee-inp{min-height:64px;resize:vertical}
select.ee-inp{cursor:pointer;appearance:none;-webkit-appearance:none;
background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath fill='%2384849c' d='M6 8L2 4h8z'/%3E%3C/svg%3E");
background-repeat:no-repeat;background-position:right 12px center;background-size:11px;padding-right:32px}
.ee-hint{font-size:10.5px;color:#6e6e86;margin-top:5px;line-height:1.5}

.ee-fold{border-radius:12px;background:rgba(255,255,255,.03);
border:1px solid rgba(255,255,255,.05);overflow:hidden;margin-bottom:8px}
.ee-fold > summary{cursor:pointer;padding:12px 14px;font-size:12.5px;color:#c4c4d8;list-style:none;
display:flex;align-items:center;gap:8px;user-select:none;transition:background .15s}
.ee-fold > summary::-webkit-details-marker{display:none}
.ee-fold > summary:hover{background:rgba(255,255,255,.03)}
.ee-fold > summary .ee-ar{margin-left:auto;font-size:10px;color:#6e6e86;transition:transform .2s}
.ee-fold[open] > summary .ee-ar{transform:rotate(180deg)}
.ee-fold-in{padding:4px 14px 14px}

.ee-state{margin:14px 20px 0;padding:11px 14px;border-radius:10px;font-size:11.5px;line-height:1.55;
background:rgba(95,179,161,.09);border:1px solid rgba(95,179,161,.22);color:#8fd6c4}
.ee-state.warn{background:rgba(208,174,60,.09);border-color:rgba(208,174,60,.22);color:#dcbb5e}

.ee-foot{display:flex;gap:8px;padding:14px 20px 0;position:sticky;bottom:0;
background:linear-gradient(180deg,rgba(20,20,25,0),#141419 30%);margin-top:8px}
.ee-btn{flex:1;padding:10px 0;border:none;border-radius:10px;font-size:13px;cursor:pointer;
font-family:inherit;transition:.16s;-webkit-tap-highlight-color:transparent;font-weight:500}
.ee-btn.pri{background:linear-gradient(145deg,#6b7cff,#8b5cf6);color:#fff;font-weight:600;
box-shadow:0 3px 12px rgba(107,124,255,.35)}
.ee-btn.pri:hover{filter:brightness(1.1);transform:translateY(-1px);
box-shadow:0 5px 16px rgba(107,124,255,.45)}
.ee-btn.gh{background:rgba(255,255,255,.06);color:#b8b8cc;border:1px solid rgba(255,255,255,.06)}
.ee-btn.gh:hover{background:rgba(255,255,255,.1);color:#dcdcea}

#ee-status{position:fixed;left:50%;top:20px;transform:translateX(-50%);z-index:999999;
background:rgba(28,28,38,.96);color:#e6e6f0;border:1px solid rgba(255,255,255,.12);
border-radius:12px;padding:12px 24px;font-size:13px;max-width:85vw;width:max-content;
box-shadow:0 8px 32px rgba(0,0,0,.6);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
transition:opacity .3s,transform .3s;line-height:1.5;text-align:center;pointer-events:none}

.ee-splash{position:fixed;inset:0;z-index:1000000;background:#141419;display:flex;flex-direction:column;
align-items:center;justify-content:center;transition:opacity .6s ease;pointer-events:none}
.ee-splash-logo{width:80px;height:80px;border-radius:22px;background:linear-gradient(145deg,#6b7cff,#8b5cf6);
display:flex;align-items:center;justify-content:center;font-size:40px;color:#fff;
box-shadow:0 10px 30px rgba(107,124,255,.4);margin-bottom:20px;animation:ee-pulse 2s infinite}
.ee-splash-t{font-size:20px;font-weight:600;color:#fff;letter-spacing:2px}
.ee-splash-s{font-size:12px;color:#84849c;margin-top:8px}
@keyframes ee-pulse{0%{transform:scale(1)}50%{transform:scale(1.05)}100%{transform:scale(1)}}
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

let statusTimer = null;
function status(text, ms = 2600) {
  try { if (settingsRef && settingsRef.showStatus === false) return; } catch {}
  const d = hostDoc() || document;
  let el = d.getElementById(STATUS_ID);
  if (!el) {
    ensureCss();
    el = d.createElement('div');
    el.id = STATUS_ID;
    (d.body || d.documentElement).appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'block';
  el.style.opacity = '1';
  clearTimeout(statusTimer);
  if (ms > 0) statusTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 200);
  }, ms);
}
function hideStatus() {
  const d = hostDoc() || document;
  const el = d.getElementById(STATUS_ID);
  if (el) { el.style.opacity = '0'; el.style.display = 'none'; }
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

function panelHtml() {
  const s = settingsRef || {};
  const bias = Number(s.intensityBias ?? 0);
  return `
<div class="ee-head">
  <div class="ee-head-row">
    <div class="ee-logo">✦</div>
    <div class="ee-title">SillyTavern 情感引擎</div>
    <button class="ee-close" data-act="close" aria-label="关闭">✕</button>
  </div>
  <div class="ee-sub">先解构人设与情境，再让模型落笔。<br>修正标签化、极端化与八股腔。</div>
</div>

<div class="ee-body">
  <div class="ee-sec">
    <div class="ee-sec-t">效果档位</div>
    <div class="ee-presets">${presetCards()}</div>
  </div>

  <div class="ee-sec">
    <div class="ee-sec-t">情绪强度</div>
    <div class="ee-card">
      <div class="ee-slider-top"><b>全局偏移</b><span class="ee-slider-val" id="ee-bv">${bias > 0 ? '+' : ''}${bias}</span></div>
      <input type="range" class="ee-range" data-k="intensityBias" data-t="num" min="-2" max="2" step="1" value="${bias}">
      <div class="ee-scale"><span>更克制</span><span>默认</span><span>更强烈</span></div>
    </div>
    <div class="ee-hint">Gemini 建议保持 0 或 -1，负数能有效压住动不动就爆发的毛病。</div>
  </div>

  <div class="ee-sec">
    <div class="ee-sec-t">基本开关</div>
    ${sw('enabled', '启用脚本', '关闭后完全不介入生成')}
    ${sw('showCard', '推演卡片', 'AI 回复顶端可折叠的卡片')}
    ${sw('cardOpen', '卡片默认展开', '默认折叠在回复里')}
    ${sw('showStatus', '显示运行提示', '推演与生成时的状态条')}
  </div>

  <div class="ee-sec">
    <div class="ee-sec-t">文风微调</div>
    ${area('extraNote', '附加要求', '例：对白占比 60% 以上、保持冷幽默', '每次推演都会带上')}
    ${txt('customForbid', '自定义禁用词', '眸光,不由自主,仿佛', '逗号分隔')}
  </div>

  <div class="ee-sec">
    <div class="ee-sec-t">进阶</div>

    <details class="ee-fold">
      <summary>触发模式<span class="ee-ar">▾</span></summary>
      <div class="ee-fold-in">
        ${sel('mode', '脚本如何介入生成', [
          ['off', '接管（我已关掉自动回复）· 推荐'],
          ['rewrite', '重写（酒馆会自动回复）'],
          ['inject', '注入（只存变量）'],
          ['manual', '手动（按住 Shift 点按钮）'],
        ], '推荐在酒馆设置里关掉自动回复后用「接管」')}
      </div>
    </details>

    <details class="ee-fold">
      <summary>推演用哪个模型<span class="ee-ar">▾</span></summary>
      <div class="ee-fold-in">
        ${sw('useSeparateApi', '给推演单独指定模型', '关闭则沿用酒馆当前连接')}
        ${txt('plannerBase', 'API 地址', 'https://你的中转地址/v1', 'OpenAI 兼容，末尾不要带 /chat/completions')}
        ${txt('plannerModel', '模型名', 'gemini-2.5-flash', '推演不需要最强模型')}
        ${txt('plannerKey', 'API Key', '留空表示不需要', '只保存在本机', true)}
        ${sel('plannerChannel', '调用方式', [
          ['generate', 'generate（自动带角色卡/世界书）'],
          ['generateRaw', 'generateRaw（精确控制提示词顺序）'],
          ['fetch', 'fetch 直连（脱离酒馆预设）'],
        ], '一般保持默认即可')}
      </div>
    </details>

    <details class="ee-fold">
      <summary>精细参数<span class="ee-ar">▾</span></summary>
      <div class="ee-fold-in">
        ${txt('plannerTemperature', '推演温度', '0.45', '0.2-0.6 较稳')}
        ${txt('plannerMaxTokens', '推演最大 token', '1400', '')}
        ${txt('plannerTimeout', '推演超时（毫秒）', '90000', '网络慢可调大')}
        ${sel('declutterLevel', '去八股强度', [
          [1, '1 · 禁写清单 + 正面写法指引'],
          [0, '0 · 只给禁写清单'],
        ], '')}
        ${sel('cardMode', '卡片展示方式', [
          ['dom', '注入楼层 DOM（推荐）· 零上下文'],
          ['block', '代码块渲染 · 持久但占上下文'],
        ], '')}
        ${sw('keepDraftLog', '留存推演日志', '以隐藏消息形式保存')}
      </div>
    </details>
  </div>
</div>

${stateBox()}

<div class="ee-foot">
  <button class="ee-btn pri" data-act="save">保存</button>
  <button class="ee-btn gh" data-act="test">测试</button>
  <button class="ee-btn gh" data-act="reset">重置</button>
</div>`;
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
  const opened = Array.from(p.querySelectorAll('.ee-fold')).map((el) => el.open);
  p.innerHTML = panelHtml();
  p.scrollTop = scroll;
  p.querySelectorAll('.ee-fold').forEach((el, i) => { if (opened[i]) el.open = true; });

  const range = p.querySelector('.ee-range');
  if (range) {
    range.addEventListener('input', () => {
      const v = Number(range.value);
      const out = p.querySelector('#ee-bv');
      if (out) out.textContent = (v > 0 ? '+' : '') + v;
    });
  }
}

function setupPanel() {
  ensureCss();
  const d = hostDoc() || document;

  // 遮罩
  if (!d.getElementById(BACKDROP_ID)) {
    const bd = d.createElement('div');
    bd.id = BACKDROP_ID;
    bd.addEventListener('click', closePanel);
    (d.body || d.documentElement).appendChild(bd);
  }

  // 面板
  if (!d.getElementById(PANEL_ID)) {
    const p = d.createElement('div');
    p.id = PANEL_ID;
    p.innerHTML = panelHtml();
    (d.body || d.documentElement).appendChild(p);

    p.addEventListener('click', (e) => {
      const preset = e.target.closest('[data-preset]');
      if (preset) {
        const key = preset.dataset.preset;
        const pv = PRESETS[key]?.values || {};
        const next = { ...collect(), preset: key, ...pv };
        settingsRef = next;
        refresh();
        status(`已切换到「${PRESETS[key].label}」档位，记得点保存`);
        return;
      }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'close') { closePanel(); return; }
      if (act === 'reset') {
        settingsRef = resetSettings();
        if (onChangeRef) onChangeRef(settingsRef);
        refresh();
        status('已恢复默认设置');
        return;
      }
      if (act === 'save') {
        settingsRef = saveSettings(collect());
        if (onChangeRef) onChangeRef(settingsRef);
        refresh();
        status('设置已保存');
        return;
      }
      if (act === 'test') {
        if (typeof testRef === 'function') testRef();
        return;
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
  btn.title = '情感引擎 · 设置（按住 Shift 点击 = 立即执行一次推演）';
  btn.textContent = '情';
  (d.body || d.documentElement).appendChild(btn);

  // 拖动逻辑
  let dragging = false, moved = false;
  let startX = 0, startY = 0, startRight = 20, startBottom = 20;

  const onDown = (e) => {
    const pt = e.touches ? e.touches[0] : e;
    dragging = true; moved = false;
    startX = pt.clientX; startY = pt.clientY;
    startRight = parseFloat(btn.style.right || 20);
    startBottom = parseFloat(btn.style.bottom || 20);
    btn.classList.add('ee-dragging');
  };
  const onMove = (e) => {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    const w = d.documentElement.clientWidth;
    const h = d.documentElement.clientHeight;
    let newRight = startRight - dx;
    let newBottom = startBottom - dy;
    newRight = Math.max(4, Math.min(w - 54, newRight));
    newBottom = Math.max(4, Math.min(h - 54, newBottom));
    btn.style.right = newRight + 'px';
    btn.style.bottom = newBottom + 'px';
    try { e.preventDefault(); } catch {}
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    btn.classList.remove('ee-dragging');
    if (moved) {
      // 保存位置
      try {
        localStorage.setItem('ee:fab-right', btn.style.right);
        localStorage.setItem('ee:fab-bottom', btn.style.bottom);
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
    const r = localStorage.getItem('ee:fab-right');
    const b = localStorage.getItem('ee:fab-bottom');
    if (r) btn.style.right = r;
    if (b) btn.style.bottom = b;
  } catch {}

  // 点击
  btn.addEventListener('click', (ev) => {
    if (moved) return;
    if (ev.shiftKey) {
      const onRun = window.__ee_manual_run__;
      if (typeof onRun === 'function') { onRun(); return; }
    }
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

function mountUi(initialSettings, onChange, onManualRun, onTest) {
  settingsRef = initialSettings;
  onChangeRef = onChange;
  testRef = onTest;
  window.__ee_manual_run__ = onManualRun;

  // 等主页面就绪
  const trySetup = (attempt = 0) => {
    const d = hostDoc();
    if (d && d.body) {
      setupFab();
      setupPanel();
      return;
    }
    if (attempt < 30) setTimeout(() => trySetup(attempt + 1), 200);
    else console.warn('[情感引擎] 拿不到主页面 document，UI 未初始化');
  };
  trySetup();

  return { open: openPanel, close: closePanel, status, hideStatus };
}

function syncSettings(s) { settingsRef = s; }
function currentSettings() { return settingsRef; }

  return { PRESETS, status, hideStatus, mountUi, syncSettings, currentSettings };
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

  return { extractJson, normalizeDraft, openaiChat, runPlanner };
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
const { mountUi, syncSettings, status, hideStatus } = __req('ui.js');

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
  if ((settings.cardMode || 'dom') !== 'dom') return 0;
  const d = hostDoc();
  if (!d) return 0;
  ensureStyle(d);

  const jobs = [];
  for (const [id, rec] of _draftCache.entries()) {
    jobs.push({ id, draft: rec.draft, degraded: rec.degraded });
  }
  try {
    const all = readMessages(0, { include_swipes: false });
    for (const m of all || []) {
      const ex = m?.extra;
      if (!ex || !ex.ee_draft) continue;
      const key = String(m.message_id);
      if (_draftCache.has(key)) continue;
      jobs.push({ id: m.message_id, draft: ex.ee_draft, degraded: !!ex.ee_degraded });
    }
  } catch {}

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

  let MO = null;
  try {
    const dv = d.defaultView || (typeof window !== 'undefined' ? window : null);
    MO = (dv && dv.MutationObserver) || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
  } catch {
    MO = typeof MutationObserver !== 'undefined' ? MutationObserver : null;
  }
  if (!MO) {
    setInterval(() => {
      if (settings.showCard && (settings.cardMode || 'dom') === 'dom') restoreCards();
    }, 3000);
    return;
  }

  let target = null;
  for (const sel of ['#chat', '#chat_log', 'body']) {
    try { target = d.querySelector(sel); if (target) break; } catch {}
  }
  if (!target) return;

  try {
    _guard = new MO(() => {
      clearTimeout(_guardTimer);
      _guardTimer = setTimeout(() => {
        if (!settings.enabled || !settings.showCard) return;
        if ((settings.cardMode || 'dom') !== 'dom') return;
        restoreCards();
      }, 400);
    });
    _guard.observe(target, { childList: true, subtree: true });
  } catch (e) {
    console.warn('[情感引擎] 守护启动失败：', e);
  }
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
  if (busy) { status('上一次推演尚未结束，已跳过'); return; }
  const myRun = ++runId;
  busy = true;

  try {
    const check = validateApi(settings);
    if (!check.ok) { status(check.message, 5000); return; }

    const userMsg = getLastUserMessage();
    if (!userMsg || !userMsg.message) { status('没读到用户消息，跳过'); return; }

    const baselineId = Number(userMsg.message_id ?? -1);
    status('① 解构人设 · 划信息边界 · 分配戏份…', 0);

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
    } catch (e) {
      console.warn('[情感引擎] 推演失败，降级：', e);
      degraded = true;
      directives = fallbackDirectives(settings);
      status(`推演失败，已降级：${String(e.message || e).slice(0, 80)}`, 4000);
    }

    if (myRun !== runId) return;

    if (settings.mode === 'inject') {
      await saveDraftVariable(directives);
      await logDraft(directives);
      status('② 推演已存入变量，在预设中加入 {{get_chat_variable::ee.draft}} 生效', 5000);
      return;
    }

    if (settings.mode === 'rewrite' && trigger === 'auto') {
      status('① 推演完成，等待原生生成结束…', 0);
      await waitFor(EVENTS.GENERATION_ENDED, 120000);
      if (myRun !== runId) return;
      await stripNativeReply(baselineId);
    }

    if (myRun !== runId) return;

    status('② 带约束生成…', 0);
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
      await sleep(500);
      await prependCard(draft, degraded, targetId);
    }

    if (draft && settings.keepDraftLog) await logDraft(JSON.stringify(draft, null, 2));
    hideStatus();
  } catch (e) {
    console.error('[情感引擎]', e);
    status(`情感引擎出错：${String(e.message || e).slice(0, 120)}`, 6000);
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
      if (settings.mode !== 'manual') {
        try {
          eventOn(EVENTS.MESSAGE_RECEIVED, (messageId, type) => {
            if (!settings.enabled || settings.mode === 'manual') return;
            if (typeof type === 'string' && ['command', 'impersonate', 'extension'].includes(type)) return;
            setTimeout(() => run('auto'), 0);
          });
        } catch (e) { console.warn('[情感引擎] 事件注册失败：', e); }
      }

      for (const evt of [EVENTS.CHAT_CHANGED, EVENTS.GENERATION_ENDED]) {
        try {
          eventOn(evt, () => {
            if (!settings.showCard) return;
            setTimeout(() => restoreCards(), 220);
          });
        } catch {}
      }
      const msg = '[情感引擎] 事件注册成功';
      console.log(msg);
      status(msg, 3000);
    } else if (attempt < 20) {
      setTimeout(() => setupEvents(attempt + 1), 500);
    } else {
      const msg = '[情感引擎] 未找到 eventOn，自动触发可能失效';
      console.warn(msg);
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
  console.error('[情感引擎] 启动失败', e);
  try { if (typeof toastr !== 'undefined') toastr.error('情感引擎启动失败：' + (e && e.message || e)); } catch (_) {}
}
})();
