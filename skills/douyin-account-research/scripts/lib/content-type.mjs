// 内容类型分类：把账号作品按"内容类型"归类，用于分析观众近期关注方向
//
// 设计原则：
//   1) 分类**跨账号通用**，否则不同账号没法比
//   2) 用可解释的加权关键词规则，不用黑盒——报告里要能说明"为什么归到这一类"
//   3) 权重分层：强信号(3) > 中信号(2) > 弱信号(1)。
//      弱信号只在没有强信号时兜底——否则"吗？"会把所有提问式标题都归成"观点输出"
//
// 踩过的坑：第一版用"无权重 + 只取第一个命中"，结果财经号 12 条里 6 条被误判成
// 「观点输出」（全因标题以"吗？"结尾），"A股为什么总在3000多点震荡"被误判成「原理科普」。
// 所以必须加权，并且把"为什么/怎么"这类高频疑问词降级为弱信号。

/** 通用类型表。pat 数组按权重从高到低排列 */
export const CONTENT_TYPES = [
  {
    key: 'tutorial', label: '知识教学',
    desc: '教你做某事：教程、入门、方法论、手把手',
    strong: /教程|教学|手把手|零基础|保姆级|从零开始|从零搭|小白教程|入门教程|学会|教你|必修|实操|使用指南|大法|步骤|避坑指南/i,
    mid: /干货|技巧|实用|科普|看懂|分钟学|分钟掌握|指南|怎么用|如何用|全流程/i,
    weak: /小白|入门|新手/i,
  },
  {
    key: 'review', label: '产品评测',
    desc: '上手体验某个工具/产品：测评、实测、开箱、对比、对决',
    // 补过一轮：原先只覆盖"测评/实测/开箱"，漏掉了"对比/对决"这类评测的常见写法——
    // 实测某账号 32 条里，一条「Codex地位不保…我拿同一个任务让它俩正面硬刚」被漏成未分类，
    // 而它本质就是产品横评。
    strong: /评测|测评|实测|开箱|亲测|上手体验|横向对比|谁更强|谁更|正面对决|正面硬刚|硬刚|对决|干掉了|地位不保|吊打|贴脸开大|哪个好|值不值|好用吗/i,
    mid: /体验|对比|试用|真香|翻车|踩坑记录|玩法|替(你|我)干活|够不够用|好在哪|难用|好用|实测过|放进|工作台/i,
    weak: /值得|好用|试了/i,
  },
  {
    key: 'industry', label: '行业解读',
    desc: '解读行业事件、格局、趋势、公司动态',
    strong: /行业|格局|赛道|洗牌|拐点|泡沫|寒冬|垄断|巨头|融资|上市|估值|财报|市场份额|搅翻|掀了|老底|变天|领先|落后|深度解析|背后的(逻辑|博弈|真相)|大洗牌|下架|征稿|一票难求/i,
    mid: /趋势|竞争|风口|爆发|走向|为什么.*(领先|落后|失败|成功)|被吹|解析|博弈|卡点|去美元化|加息|通胀|关税|金饭碗|百万年薪|赢家|首个|首款|第一(个|款)/i,
    weak: /市场|公司|企业|职业/i,
  },
  {
    key: 'opinion', label: '观点输出',
    desc: '表达立场、反驳、预测、辩论',
    strong: /我认为|我觉得|说白了|反驳|回应质疑|别信|不要信|误区|误解|谣言|打脸|争议|辟谣/i,
    mid: /到底|是不是|真的吗|有人问|答疑|澄清|还相信|值得吗/i,
    weak: /吗？|吗\?|呢？|呢\?|真相/i,
  },
  {
    key: 'explainer', label: '原理科普',
    desc: '解释一个概念/原理/学术内容',
    // 注意："架构"从强信号降级到中信号——它经常只出现在话题标签里（#大模型架构），
    // 会把"Claude 领先 GPT"这类行业对比标题误判成原理科普。
    strong: /原理|是什么|什么是|谁是|底层|本质|算法|论文|学术|机制|推导|数学模型|量子|attention is all/i,
    mid: /科普|概念|为什么会|如何运作|怎么理解|真相|架构/i,
    weak: /为什么|怎么|是什么原因/i,
  },
  {
    key: 'news', label: '资讯速递',
    desc: '发布/更新/上线等时效性消息',
    strong: /正式发布|官宣|上线|首发|内测|公测|正式版|独家|快讯|最新动态|全球首款|全球首个/i,
    mid: /更新|升级|推出|宣布|来了|新版本|大更新|首款|首个|AGI|已经来了/i,
    weak: /今日|刚刚|最新|出了|新出/i,
  },
  {
    key: 'story', label: '故事案例',
    desc: '讲一个具体的故事、案例、人物经历',
    strong: /人物志|访谈|对话|传记|回忆录|他当年|她当年|一次难忘的经历/i,
    mid: /故事|案例|经历|他怎么|她怎么|背后的渊源/i,
    weak: /那年|后来/i,
  },
  {
    key: 'career', label: '职业成长',
    desc: '工作方式、职业选择、能力成长、变现思路',
    strong: /职业发展|职场|面试题|简历|跳槽|裁员|副业|学习路线|职业规划|职称|晋升/i,
    mid: /工程师|岗位|招聘|转型|能力成长|赚钱|收入|导学|学习路径|金饭碗|百万年薪|搞钱|变现|复刻.{0,6}账号|替你干活|替你上班|帮我干活/i,
    weak: /工作|就业|干活/i,
  },
  {
    key: 'lifestyle', label: '泛生活/其他',
    // 只留娱乐/生活向的强特征。
    // 两次踩坑：
    //   1) 曾把 心理|健康|经济 放进来 → 财经科普被误吸
    //   2) 曾用裸词「游戏」→ 命中了"美元霸权游戏""价格游戏"这类比喻用法（金融内容里极常见）
    // 所以「游戏」必须带限定词，"经济/金融/心理/健康"一律不进本类。
    desc: '与主业无关的泛知识、生活、娱乐',
    strong: /猫|狗狗|美食|旅行|风景|恋爱|婚姻|育儿|手游|网游|玩游戏|游戏攻略|电影|音乐|搞笑|宠物|减肥|穿搭|做饭|旅游/i,
    mid: /生活日常|放松|解压|情绪管理|美食推荐|日常vlog/i,
    weak: /好玩|有趣/i,
  },
];

const W = { strong: 3, mid: 2, weak: 1 };

/** 统计某个正则在文本里的匹配次数 */
const hitsOf = (pat, text) => {
  if (!pat) return [];
  const m = String(text).match(new RegExp(pat.source, 'gi'));
  return m ? m.map((s) => s.trim()) : [];
};

/**
 * 给一条作品分类。返回 { key, label, why, score, allScores }
 * 规则：每类按 强×3 + 中×2 + 弱×1 计算总分，取最高分；全为 0 则归 other。
 *
 * 重要：**只拿标题/文案做判断，不喂话题标签**。
 * 标签是噪声——踩过的坑：#大模型架构 这个标签把「为何Claude领先GPT」误判成「原理科普」。
 * 只有在文案为空时才退回用标签。
 */
export function classifyContent(video, options = {}) {
  const types = options.types || CONTENT_TYPES;
  const cleanDesc = String(video.desc || '')
    .replace(/#[^\s#]+/g, ' ')          // 去掉话题标签
    .replace(/\s+/g, ' ')
    .trim();
  // 文案够长就用文案；太短（如只有一句口号）才把标签算进来
  const text = (cleanDesc.length >= 6 ? cleanDesc : `${cleanDesc} ${video.tags || ''}`).trim();
  if (!text) return { key: 'other', label: '未分类', why: '无文案', score: 0, allScores: {} };

  const scores = [];
  const allScores = {};
  for (const t of types) {
    const s = hitsOf(t.strong, text).length * W.strong
      + hitsOf(t.mid, text).length * W.mid
      + hitsOf(t.weak, text).length * W.weak;
    allScores[t.key] = s;
    if (s > 0) scores.push({ ...t, score: s });
  }
  if (!scores.length) return { key: 'other', label: '未分类', why: '未命中任何规则', score: 0, allScores };

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const hits = [...hitsOf(best.strong, text), ...hitsOf(best.mid, text)].slice(0, 4);
  return { key: best.key, label: best.label, why: hits.join('/') || '（仅弱信号）', score: best.score, allScores };
}

/** 交叉分析用的指标 */
export const CROSSTAB_METRICS = ['count', 'diggMedian', 'diggMax', 'collectRate', 'shareRate', 'commentRate'];
