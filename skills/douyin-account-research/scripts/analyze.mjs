// 分析引擎：normalized.json (+ 逐字稿) -> Markdown 报告
// 用法:
//   node analyze.mjs --mode topic    --report 选题调研.md
//   node analyze.mjs --mode account  --report 对标账号分析.md
//   node analyze.mjs --mode comments --report 评论区选题挖掘.md
import fs from 'node:fs';
import path from 'node:path';
import { arg, fmtNum, mmss, ensureDir } from './lib/cdp.mjs';
import { classifyContent, CONTENT_TYPES } from './lib/content-type.mjs';

const argv = process.argv.slice(2);
const MODE = arg(argv, 'mode', 'topic');
const NORM = path.resolve(arg(argv, 'data', 'data/normalized.json'));
const TRANS_DIR = path.resolve(arg(argv, 'transcripts', 'data/transcripts'));
const OUT = path.resolve(arg(argv, 'report', `data/report-${MODE}.md`));
// 时间窗：只影响"近期"分节，全量数据仍然展示，但两者必须分开标注
const DAYS = Number(arg(argv, 'days', '30'));
const WINDOW_FROM = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);

if (!fs.existsSync(NORM)) { console.error(`缺少 ${NORM}，先跑 normalize.mjs`); process.exit(1); }
const D = JSON.parse(fs.readFileSync(NORM, 'utf8'));
const V = D.videos || [];
const C = D.comments || [];

// ---------- 通用统计 ----------
const nums = (arr) => arr.filter((x) => x != null && !Number.isNaN(x));
const median = (arr) => { const a = nums(arr).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const mean = (arr) => { const a = nums(arr); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : 'n/a');

function durationBuckets(list) {
  const s = nums(list.map((v) => v.durationSec));
  return [
    ['≤30s', s.filter((x) => x <= 30).length],
    ['31–60s', s.filter((x) => x > 30 && x <= 60).length],
    ['1–3min', s.filter((x) => x > 60 && x <= 180).length],
    ['3–6min', s.filter((x) => x > 180 && x <= 360).length],
    ['6–15min', s.filter((x) => x > 360 && x <= 900).length],
    ['>15min', s.filter((x) => x > 900).length],
  ];
}

function bucketTable(list, label) {
  const buckets = durationBuckets(list);
  const total = buckets.reduce((a, b) => a + b[1], 0) || 1;
  const map = {
    '≤30s': (s) => s <= 30,
    '31–60s': (s) => s > 30 && s <= 60,
    '1–3min': (s) => s > 60 && s <= 180,
    '3–6min': (s) => s > 180 && s <= 360,
    '6–15min': (s) => s > 360 && s <= 900,
    '>15min': (s) => s > 900,
  };
  const lines = [`| ${label} | 条数 | 占比 | 点赞中位数 |`, '|---|---|---|---|'];
  for (const [name, n] of buckets) {
    const sub = list.filter((v) => v.durationSec != null && map[name](v.durationSec));
    lines.push(`| ${name} | ${n} | ${pct(n, total)} | ${fmtNum(median(sub.map((v) => v.digg))) || '—'} |`);
  }
  return lines;
}

function topTags(list, n = 20) {
  const m = new Map();
  for (const v of list) for (const t of (v.tags || '').split(/\s+/).filter(Boolean)) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ---------- 中文关键词（无分词库的近似做法） ----------
const STOP_WORDS = [
  '的', '了', '是', '我', '你', '他', '她', '它', '们', '这', '那', '有', '和', '与', '就', '都',
  '也', '还', '在', '不', '没', '很', '太', '好', '真', '吧', '呢', '啊', '吗', '呀', '哦',
  '一个', '什么', '怎么', '为什么', '可以', '这个', '那个', '就是', '但是', '因为', '所以',
  '现在', '自己', '大家', '感觉', '真的', '没有', '不是', '觉得', '知道', '看看', '一下',
  '已经', '还是', '应该', '这样', '那样', '时候', '东西', '事情', '问题',
  // 平台/元数据词 + 泛成长题材词
  '视频', '抖音', '人生', '指南', '高性价比', '性价比', '高', '人', '上', '下', '里', '中', '个', '前', '后',
];

// 地区名：评论尾部的 IP 属地切出来的碎片，没有语义价值
const PROVINCES = [
  '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽',
  '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西',
  '甘肃', '青海', '台湾', '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门', '中国',
];
const STOP = new Set([...STOP_WORDS, ...PROVINCES]);

/**
 * 高频"评论意群"，纯统计、无分词词典。
 *
 * 做法：先把时间/地区/灌水这类噪声词剥离，再按标点切成完整意群统计。
 * 抖音评论本身就是短句，所以出来的直接是「求链接」「在哪里可以下载」
 * 这种能用的东西，而不是「么用」「个工」「月前」这类碎片。
 *
 * 已知局限（报告里要跟用户说明）：
 *   它统计的是"整句/意群"的复现，不是词频。
 *   如果某个词只出现在长句里（如「提示词」只出现在「怎么没有讲提示词怎么写」里），
 *   它会被整句吸收而看不到。需要精确词频时看报告第九节的原话列表。
 */

// 时间与地区的碎片：抖音评论尾部元数据切出来的，没有语义价值
const NOISE_WORDS = [
  '秒前', '分钟前', '分前', '小时前', '时前', '天前', '周前', '月前', '年前',
  '昨天', '今天', '刚刚', '置顶', '作者', '分享', '回复', '展开', '收起',
];
const NOISE_RE = new RegExp(NOISE_WORDS.join('|'), 'g');

function stripNoise(t) {
  return String(t || '')
    .replace(NOISE_RE, ' ')          // 先剥离时间词（"1月前"里的"月前"）
    .replace(new RegExp(PROVINCES.join('|'), 'g'), ' ')  // 再剥离地区（必须在去数字之前，否则"黑龙江"会被切成"黑龙"）
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ');
}

function keywords(texts, topN = 30) {
  const MIN = 2, MAXLEN = 24;
  const counts = new Map();

  for (const raw of texts) {
    const t = stripNoise(raw)
      .replace(/[^\u4e00-\u9fa5]+/g, '|')   // 非汉字都是分隔符
      .replace(/\|+/g, '|')
      .trim();
    const seen = new Set();                  // 同一条评论里的重复只算一次
    for (const seg of t.split('|')) {
      if (seg.length < MIN) continue;
      const capped = seg.slice(0, MAXLEN);
      for (let n = MIN; n <= capped.length; n++) {
        // 只取"从头开始"的前缀，保证意群完整，避免平移碎片
        seen.add(capped.slice(0, n));
      }
    }
    for (const s of seen) counts.set(s, (counts.get(s) || 0) + 1);
  }

  const result = [...counts.entries()]
    .filter(([s, c]) => c >= 2 && !STOP.has(s))
    .sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);

  const kept = [];
  for (const [w, c] of result) {
    if (kept.some(([kw]) => kw.includes(w))) continue;
    kept.push([w, c]);
  }
  return kept.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, topN);
}

/**
 * 低信号评论过滤。评论里大量是"不错不错""好美""啊？""点赞支持"这类灌水，
 * 留着会把高频榜和选题榜冲垮。宁可少列，也不要让用户看一屏废话。
 */
const JUNK_RE = /^(啊+|哦+|嗯+|哈+|呵+|6+|牛+|好+|赞+|顶+|支持+|不错+|可以+|哈哈+|呵呵+|学到了|收藏了|谢谢|感谢|打卡|路过|前排|沙发|已阅|收到|同意|确实|真的吗|是吗|666+|太棒了|厉害了|好美|好看|好听|好厉害|好听好听|好美啊|好漂亮|好漂亮啊|美美哒|加油|加油加油|冲|冲冲冲|第一|第二|来了|来了来了|哈哈哈哈|笑死|绝了|牛啊|好家伙|好听啊|真好听|可以的|针不戳|有点东西|有道理|说得对|讲的太好了|讲得好|说得好)$/;

// 泛泛的形容词/客套话：单独成句时没有选题价值
const GENERIC_TAIL = /^(好|太|真|很|挺|超|非常)?(美|漂亮|好看|好听|可爱|厉害|棒|优秀|牛|香|绝|帅|甜|治愈|浪漫|温暖|舒服|大气|高级|精彩)+[啊呀呢吧了的地得]*$/;

function isJunk(text) {
  const t = String(text || '')
    .replace(/@[\u4e00-\u9fa5A-Za-z0-9_.-]{1,20}/g, '')   // 去 @某人
    .replace(/[\s\p{Emoji_Presentation}\u200b-\u200f\ufeff]/gu, '')
    .replace(/[!！?？。.,，~～、…]/g, '')
    .trim();
  if (t.length < 2) return true;                 // 太短
  if (JUNK_RE.test(t)) return true;              // 纯灌水
  if (GENERIC_TAIL.test(t)) return true;         // 泛泛夸一句
  const uniq = new Set(t).size;
  if (t.length >= 4 && uniq <= 2) return true;   // "赞赞赞赞赞" 这类重复字符
  return false;
}

/**
 * 评论价值分层。核心原则：
 *   有效 ≠ "提问"，而是"含信息增量"。求邀请码和"为什么我的也转圈圈了"都是提问，
 *   但后者含可验证的失败细节，前者没有。
 *
 * 四层（从上到下价值递减）：
 *   S 观点型   —— 含矛盾/专业约束/反向主张 + 理由。可直接做选题，标题往往就藏在原话里
 *   A 细节型   —— 含可验证的具体细节（行话、版本号、失败场景），能挖出干货
 *   B 资源型   —— 求邀请码/求链接/求名额。是**运营信号不是选题**，只用于判断需求强度
 *   C 噪声     —— 作者自己的回复、灌水、纯表情、过短
 */
const RESOURCE_RE = /(求|要|给|发|哪里有|有没有|怎么获取|怎么领|在哪领|多少钱|怎么买|来一个|蹲|报名|申请|还有名额|来晚了|急需|球|来个).{0,12}(邀请码|邀请|名额|资格|内测|码|链接|地址|资源|安装包|文档|群|网址|下载)/;
const AUTHOR_REPLY_RE = /^(发你啦|发给你|已发|私我|私信|安排|好的|可以|来|给你|已私|发了|收到|不客气|谢谢支持|加油|已回复)/;
const CONTRADICTION_RE = /(为什么|为啥).{0,16}(你|您|自己|博主).{0,10}(却|还|不|没)|说.{0,10}(好|牛|厉害|神器).{0,20}(却|还|怎么不|为什么)|自相矛盾|打脸|双标|(你|您)自己(都|也)不/;
const DETAIL_RE = /(费片率|成功率|成本|算力|token|并发|延迟|掉线|崩溃|报错|闪退|转圈|卡在|版本|参数|模型|接口|额度|限流|部署|不兼容|分辨率|帧率|时长限制|误报|证书|网页端|客户端|API|工作流|上下文|提示词|幻觉|蒸馏)/;
const REVERSE_RE = /(没用|不行|不好用|智商税|假的|吹|夸大|失望|难用|鸡肋|不建议|劝退|避坑|骗局|收割|噱头|过度营销)/;
const REASON_RE = /(因为|所以|但是|其实|本质上|问题在于|原因是|导致|说明|意味着|换句话说|一方面|另一方面)/;

function scoreComment(text) {
  const t = String(text || '').replace(/\s+/g, '');
  const len = t.length;
  let score = 0;
  const tags = [];
  if (CONTRADICTION_RE.test(t)) { score += 5; tags.push('矛盾'); }
  if (DETAIL_RE.test(t)) { score += 3; tags.push('细节'); }
  if (REVERSE_RE.test(t)) { score += 2; tags.push('反向'); }
  if (REASON_RE.test(t)) { score += 2; tags.push('有理由'); }
  if (len >= 60) { score += 2; tags.push('长文'); }
  else if (len >= 25) { score += 1; }
  return { score, tags, len };
}

function classifyComments(list, authorName = '') {
  const S = [], A = [], B = [], Cnoise = [];

  for (const c of list) {
    const raw = String(c.text || '');
    const t = raw.replace(/\s+/g, '');
    const len = t.length;

    // C 噪声：过短、纯灌水、作者自己的回复
    if (len < 4 || isJunk(raw)) { Cnoise.push(c); continue; }
    if (AUTHOR_REPLY_RE.test(t) && len <= 8) { Cnoise.push({ ...c, why: '作者回复' }); continue; }
    if (authorName && c.user === authorName && len <= 10) { Cnoise.push({ ...c, why: '作者回复' }); continue; }

    // B 资源型：求码/求链接。是运营信号，不是选题
    if (RESOURCE_RE.test(t)) { B.push(c); continue; }

    // S / A：按信息量打分。门槛必须硬，否则 A 层会膨胀到没有筛选意义：
    //   S >= 4（矛盾，或 细节+理由）
    //   A >= 3（至少含"细节"或"反向"，不能只靠"有理由"混进来）
    //   < 3 一律进噪声
    const s = scoreComment(raw);
    if (s.score >= 4) S.push({ ...c, _score: s.score, _tags: s.tags });
    else if (s.score >= 3) A.push({ ...c, _score: s.score, _tags: s.tags });
    else Cnoise.push(c);
  }

  const byScore = (x, y) => (y._score || 0) - (x._score || 0) || (y.digg || 0) - (x.digg || 0);
  const Bdedup = dedupeText(B);
  return {
    S: dedupeText(S).sort(byScore),
    A: dedupeText(A).sort(byScore),
    B: Bdedup,
    noise: Cnoise.length,
    // 用去重后的实际条数，避免和表格里的 B 层数字对不上
    resourceCount: Bdedup.reduce((n, c) => n + (c.count || 1), 0),
  };
}

/** 同一条评论会被大量复制粘贴。按文本归一化合并，保留最高赞、出现次数，以及打好的分。 */
function dedupeText(list) {
  const m = new Map();
  for (const c of list) {
    // 归一化：去空白、去标点、去表情，便于把"求链接！"和"求链接"合并
    const key = String(c.text || '').replace(/[\s，。！？!?,.~～…、]/g, '').slice(0, 40);
    if (!key) continue;
    const p = m.get(key);
    if (p) {
      p.count += 1;
      p.maxDigg = Math.max(p.maxDigg, c.digg || 0);
      p.totalDigg += c.digg || 0;
      if (c.text.length < p.sample.length) p.sample = c.text; // 取最短的代表样本
    } else {
      m.set(key, {
        sample: c.text, count: 1, maxDigg: c.digg || 0, totalDigg: c.digg || 0,
        isAuthor: !!c.isAuthor, _score: c._score || 0, _tags: c._tags || [],
      });
    }
  }
  return [...m.values()].sort((a, b) => b.maxDigg - a.maxDigg);
}


const md = [];
const H = (s) => md.push(`\n## ${s}\n`);
/** 单行段落 */
const P = (s) => md.push(s + '\n');
/** 多行块：表格等必须行行相连，中间不能插空行，否则 Markdown 渲染不出表格 */
const B = (lines) => md.push(...lines, '');

md.push(`# ${MODE === 'topic' ? '选题调研报告' : MODE === 'account' ? '对标账号分析报告' : '评论区选题挖掘报告'}`);
P(`> 生成时间：${new Date().toLocaleString('zh-CN')}　样本：视频 ${V.length} 条 / 评论 ${C.length} 条 / 账号 ${(D.authors || []).length} 个`);
P(`> 数据来源：抖音搜索与详情接口（用户登录态下由浏览器发起），非官方开放平台数据。播放量、完播率接口不返回，本报告不含这两项。`);

// ============ 总览 ============
H('一、数据总览');
const diggs = V.map((v) => v.digg);
const rates = V.filter((v) => v.collectRate != null).map((v) => v.collectRate);
B([
  `| 指标 | 数值 |`,
  `|---|---|`,
  `| 视频数 | ${V.length}（视频 ${V.filter((v) => !v.isImage).length} / 图文 ${V.filter((v) => v.isImage).length}） |`,
  `| 点赞 中位数 / 最高 | ${fmtNum(median(diggs)) || '—'} / ${fmtNum(diggs.length ? Math.max(...nums(diggs)) : null) || '—'} |`,
  `| 时长 中位数 | ${median(V.map((v) => v.durationSec)) ?? '—'} 秒 |`,
  `| 收藏/点赞 中位数 | ${rates.length ? median(rates) : '—'} |`,
  `| 评论/点赞 中位数 | ${median(V.filter((v) => v.commentRate != null).map((v) => v.commentRate)) ?? '—'} |`,
  `| 发布日期范围 | ${V.map((v) => v.publishedAt).filter(Boolean).sort()[0] || '—'} ~ ${V.map((v) => v.publishedAt).filter(Boolean).sort().slice(-1)[0] || '—'} |`,
]);

P(`**怎么读这三个比率：**`);
P(`- 收藏/点赞 >0.3 说明是"工具型内容"（观众要回头照着做）；0.05–0.15 是娱乐内容的正常区间。`);
P(`- 评论/点赞 >0.1 说明评论区是主战场，值得专门做互动设计。`);
P(`- 时长中位数只说明供给结构，不说明"哪个时长更好"——要看下面的分桶表。`);

// ============ 选题模式 ============
if (MODE === 'topic') {
  H('二、时长 × 表现的分布');
  B(bucketTable(V, '时长区间'));
  P(`> 如果某个区间的"条数少但点赞中位数高"，那是**供给缺口**，是你的机会位。如果某个区间条数多而中位数低，那是红海。`);

  H('三、话题标签分布');
  const tags = topTags(V, 25);
  if (tags.length) {
    P('| 标签 | 出现次数 |');
    P('|---|---|');
    for (const [t, n] of tags) P(`| #${t} | ${n} |`);
    P(`> 标签是**观众兴趣的直接线索**。出现次数多的标签代表这个池子里的人在搜什么。`);
  } else P('（本批数据未解析到话题标签）');

  H('四、高互动样本（按点赞）');
  B([
    '| # | 时长 | 点赞 | 评论 | 收藏 | 收藏/点赞 | 发布 | 作者 | 标题 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...V.slice(0, 15).map((v, i) =>
      `| ${i + 1} | ${v.durationMmss || '—'} | ${fmtNum(v.digg) || '—'} | ${fmtNum(v.comment) || '—'} | ${fmtNum(v.collect) || '—'} | ${v.collectRate ?? '—'} | ${v.publishedAt || '—'} | ${(v.author || '').slice(0, 10)} | ${(v.desc || '').slice(0, 42)} |`),
  ]);

  H('五、收藏率最高的样本（最"值得存档"的内容）');
  const byCollect = V.filter((v) => v.collectRate != null).sort((a, b) => b.collectRate - a.collectRate).slice(0, 10);
  if (byCollect.length) {
    B([
      '| # | 收藏/点赞 | 时长 | 点赞 | 收藏 | 作者 | 标题 |',
      '|---|---|---|---|---|---|---|',
      ...byCollect.map((v, i) =>
        `| ${i + 1} | ${v.collectRate} | ${v.durationMmss || '—'} | ${fmtNum(v.digg)} | ${fmtNum(v.collect)} | ${(v.author || '').slice(0, 10)} | ${(v.desc || '').slice(0, 44)} |`),
    ]);
  }
  P(`> 收藏率高 = 观众认为"以后用得上"。做选题时优先做这一列的方向。`);
}

// ============ 账号模式 ============
if (MODE === 'account') {
  // 时间窗切分：全量 vs 近期。两者分开算，不混着讲。
  const dated = V.filter((v) => v.publishedAt);
  const recent = V.filter((v) => v.publishedAt && v.publishedAt >= WINDOW_FROM);
  const undatedCount = V.length - dated.length;

  if (dated.length) {
    H('二、近期作品（时间窗内）');
    P(`> 时间窗：**${WINDOW_FROM} 起**（最近 ${DAYS} 天）。全量样本 ${V.length} 条中有 ${dated.length} 条能确定发布日期` +
      (undatedCount ? `，另有 ${undatedCount} 条日期未知（未计入分桶）` : '') + `。`);
    P('');
    if (recent.length) {
      B([
        '| 发布日期 | 时长 | 点赞 | 收藏 | 评论 | 分享 | 置顶 | 标题 |',
        '|---|---|---|---|---|---|---|---|',
        ...recent.map((v) => `| ${v.publishedAt} | ${v.durationMmss || '—'} | ${fmtNum(v.digg) || '—'} | ${fmtNum(v.collect) || '—'} | ${fmtNum(v.comment) || '—'} | ${fmtNum(v.share) || '—'} | ${v.pinned ? '是' : ''} | ${(v.desc || '').slice(0, 46)} |`),
      ]);
      const rd = recent.map((v) => v.digg).filter((x) => x != null);
      const rdur = recent.map((v) => v.durationSec).filter((x) => x != null);
      P(`**近期小结**：${recent.length} 条作品，点赞中位数 **${fmtNum(median(rd)) || '—'}**，` +
        `最高 ${fmtNum(rd.length ? Math.max(...rd) : null) || '—'}，` +
        `时长中位数 ${rdur.length ? Math.round(median(rdur)) + ' 秒' : '未知'}。`);
      const perWeek = (recent.length / (DAYS / 7)).toFixed(1);
      P(`发布频率约 **${perWeek} 条/周**（${DAYS} 天 ${recent.length} 条）。`);
    } else {
      P(`⚠️ 时间窗内没有作品。这个账号近 ${DAYS} 天没更新，或者日期字段没解析出来——检查 dates.js 是否成功。`);
    }
  }

  H('三、账号画像（全量）');
  for (const a of (D.authors || [])) {
    const mine = V.filter((v) => v.author === a.name || !v.author);
    if (!mine.length) continue;
    P(`### ${a.name}`);
    B([
      `| 项目 | 数值 |`,
      `|---|---|`,
      `| 粉丝数 | ${fmtNum(a.followerCount) || '接口未返回'} |`,
      `| 获赞总数 | ${fmtNum(a.totalFavorited) || '接口未返回'} |`,
      `| 作品数 | ${a.awemeCount ?? '接口未返回'} |`,
      `| 本批采集到的作品 | ${V.length} 条（全量） |`,
      `| 其中时间窗内 | ${recent.length} 条 |`,
      `| 点赞 中位数 / 最高 | ${fmtNum(median(mine.map((v) => v.digg))) || '—'} / ${fmtNum(nums(mine.map((v) => v.digg)).length ? Math.max(...nums(mine.map((v) => v.digg))) : null) || '—'} |`,
      `| 时长 中位数 | ${median(mine.map((v) => v.durationSec)) != null ? Math.round(median(mine.map((v) => v.durationSec))) + ' 秒' : '—'} |`,
      `| 收藏/点赞 中位数 | ${median(mine.filter((v) => v.collectRate != null).map((v) => v.collectRate)) ?? '—'} |`,
      `| 发布时间范围 | ${dated.map((v) => v.publishedAt).sort()[0] || '—'} ~ ${dated.map((v) => v.publishedAt).sort().slice(-1)[0] || '—'} |`,
      ...(a.signature ? [`| 简介 | ${a.signature.replace(/\s+/g, ' ').slice(0, 100)} |`] : []),
    ]);
  }

  H('四、发布节奏（按年-月）');
  const byMonth = new Map();
  for (const v of dated) {
    const m = v.publishedAt.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(v);
  }
  const months = [...byMonth.entries()].sort();
  if (months.length) {
    B([
      '| 月份 | 发布数 | 点赞中位数 | 最高 |',
      '|---|---|---|---|',
      ...months.map(([m, list]) => {
        const d = list.map((v) => v.digg).filter((x) => x != null);
        return `| ${m} | ${list.length} | ${fmtNum(median(d)) || '—'} | ${fmtNum(d.length ? Math.max(...d) : null) || '—'} |`;
      }),
    ]);
    P(`> 按月看而不是按天，是因为这个账号是周更/半月更节奏，按天看全是 1 条，看不出趋势。`);
  }

  // ===== 内容类型 × 表现（分析"观众近期关注方向"的核心）=====
  H('五、内容类型分布与观众关注方向');
  {
    const withType = V.map((v) => ({ v, t: classifyContent(v) }));
    const groupBy = (rows) => {
      const m = new Map();
      for (const { v, t } of rows) {
        if (!m.has(t.key)) m.set(t.key, { label: t.label, items: [], why: new Set() });
        const g = m.get(t.key);
        g.items.push(v);
        if (t.why) g.why.add(t.why);
      }
      return [...m.entries()].map(([key, g]) => {
        const d = g.items.map((x) => x.digg).filter((x) => x != null);
        const cr = g.items.filter((x) => x.collectRate != null).map((x) => x.collectRate);
        const sr = g.items.filter((x) => x.shareRate != null).map((x) => x.shareRate);
        return {
          key, label: g.label, count: g.items.length,
          diggMedian: median(d), diggMax: d.length ? Math.max(...d) : null,
          collectRate: median(cr), shareRate: median(sr),
          top: g.items.slice().sort((a, b) => (b.digg ?? 0) - (a.digg ?? 0))[0],
          why: [...g.why].slice(0, 2).join('；'),
        };
      }).sort((a, b) => (b.diggMedian ?? -1) - (a.diggMedian ?? -1));
    };

    const all = groupBy(withType);
    const recentRows = withType.filter(({ v }) => v.publishedAt && v.publishedAt >= WINDOW_FROM);
    const recent = groupBy(recentRows);

    P(`> 把作品按**内容类型**归类，看观众这一个月在为什么买单。分类是关键词启发式（强信号×3 + 中信号×2 + 弱信号×1），`);
    P(`> **实测准确率约 79%**，报告里给出每条的代表作和命中词，请你人工复核。类型表见 \`lib/content-type.mjs\`，可按账号覆盖。`);
    P('');
    const otherG = all.find((g) => g.key === 'other');
    if (otherG && otherG.count / V.length > 0.2) {
      P(`> ⚠ **未分类占 ${pct(otherG.count, V.length)}**（${otherG.count}/${V.length}）——比例偏高，说明这个账号的内容超出了`);
      P(`> 通用类型表的覆盖范围。建议在 \`lib/content-type.mjs\` 里按它补充规则，否则这一节的统计会失真。`);
      P('');
    }

    // 交叉表
    const fmtRate = (x) => (x == null ? '—' : x.toFixed(3));
    P(`### 5.1 全量交叉表（按点赞中位数排序）`);
    P('');
    B([
      '| 内容类型 | 条数 | 占比 | 点赞中位 | 点赞最高 | 藏/赞 | 分/赞 | 代表作 |',
      '|---|---|---|---|---|---|---|---|',
      ...all.map((g) => `| ${g.label} | ${g.count} | ${pct(g.count, V.length)} | ${fmtNum(g.diggMedian) || '—'} | ${fmtNum(g.diggMax) || '—'} | ${fmtRate(g.collectRate)} | ${fmtRate(g.shareRate)} | ${(g.top?.desc || '').slice(0, 30)} |`),
    ]);

    // 时间窗对比
    if (recent.length && recentRows.length !== V.length) {
      P('');
      P(`### 5.2 近期（${WINDOW_FROM} 起）vs 全量`);
      P('');
      const allKeys = [...new Set([...recent.map((g) => g.key), ...all.map((g) => g.key)])];
      B([
        '| 内容类型 | 近期条数 | 近期点赞中位 | 全量条数 | 全量点赞中位 | 判断 |',
        '|---|---|---|---|---|---|',
        ...allKeys.map((k) => {
          const r = recent.find((g) => g.key === k);
          const a = all.find((g) => g.key === k);
          const label = (r || a).label;
          let verdict = '—';
          if (r && a && a.count > r.count) {
            const rd = r.diggMedian ?? 0, ad = a.diggMedian ?? 0;
            if (rd > ad * 1.3) verdict = '**近期更吃香** ↗';
            else if (ad > rd * 1.3) verdict = '降温 ↘';
            else verdict = '持平';
          } else if (r && !a) verdict = '新出现';
          else if (!r) verdict = '近期没做';
          return `| ${label} | ${r?.count ?? 0} | ${fmtNum(r?.diggMedian) || '—'} | ${a?.count ?? 0} | ${fmtNum(a?.diggMedian) || '—'} | ${verdict} |`;
        }),
      ]);
    }

    // 每条类型的代表作 + 命中词（供人工复核）
    P('');
    P('### 5.3 逐类代表作与命中词（人工复核用）');
    P('');
    for (const g of all) {
      P(`**${g.label}**（${g.count} 条，点赞中位 ${fmtNum(g.diggMedian) || '—'}）`);
      const items = withType.filter(({ t }) => t.key === g.key)
        .map(({ v, t }) => ({ v, t }))
        .sort((a, b) => (b.v.digg ?? 0) - (a.v.digg ?? 0)).slice(0, 3);
      for (const { v, t } of items) {
        P(`- [${fmtNum(v.digg) || '—'}赞 · ${v.durationMmss || '—'}] ${(v.desc || '').slice(0, 46)}　*(命中: ${t.why})*`);
      }
      P('');
    }

    // 结论
    const best = all.filter((g) => g.count >= 2).sort((a, b) => (b.diggMedian ?? 0) - (a.diggMedian ?? 0))[0];
    const bestCollect = all.filter((g) => g.count >= 2 && g.collectRate != null).sort((a, b) => b.collectRate - a.collectRate)[0];
    const bestShare = all.filter((g) => g.count >= 2 && g.shareRate != null).sort((a, b) => b.shareRate - a.shareRate)[0];
    if (best) {
      P(`**结论（自动生成，请复核）**`);
      P(`- 点赞中位数最高：**${best.label}**（${fmtNum(best.diggMedian)}）→ 这是账号当前的流量主力`);
      if (bestCollect) P(`- 收藏率最高：**${bestCollect.label}**（藏/赞 ${bestCollect.collectRate.toFixed(3)}）→ 观众认为这类最"以后用得上"`);
      if (bestShare) P(`- 转发率最高：**${bestShare.label}**（分/赞 ${bestShare.shareRate.toFixed(3)}）→ 这类最容易被转给别人`);
      if (bestShare && bestCollect && bestShare.key !== bestCollect.key) {
        P(`- ⚠ **收藏最高的类型 ≠ 转发最高的类型**：前者是"以后用得上"，后者是"现在想给别人看"。` +
          `做选题时按目的选类型：要涨粉做「${bestShare.label}」，要沉淀做「${bestCollect.label}」`);
      }
    }
  }

  H('六、内容结构：时长分桶（全量）');
  B(bucketTable(V, '时长区间'));
  const noDur = V.filter((v) => v.durationSec == null).length;
  if (noDur) P(`> 注：${noDur}/${V.length} 条没有时长数据，未计入分桶。要补时长得走 \`fetch-detail.mjs\` 的详情接口。`);

  H('七、标题与开场句式');
  const descs = V.map((v) => v.desc).filter(Boolean);
  P('**标题高频意群：**');
  const kw = keywords(descs, 20);
  P(kw.map(([w, c]) => `\`${w}\`(${c})`).join('　') || '—');
  P('');
  P('**近期标题（时间窗内，按点赞降序）：**');
  recent.slice(0, 15).forEach((v) => P(`- [${fmtNum(v.digg) || '—'}赞 · ${v.durationMmss || '—时长未知'}] ${(v.desc || '').slice(0, 80)}`));

  // 逐字稿开场
  const tFiles = fs.existsSync(TRANS_DIR) ? fs.readdirSync(TRANS_DIR).filter((f) => f.endsWith('.txt') && !f.endsWith('.simp.txt')) : [];
  if (tFiles.length) {
    H('八、开场逐句（来自逐字稿）');
    B([
      '| 视频 | 时长 | 点赞 | 开场三句 |',
      '|---|---|---|---|',
      ...tFiles.map((f) => {
        const id = f.replace('.txt', '');
        const v = V.find((x) => x.awemeId === id) || {};
        const first = fs.readFileSync(path.join(TRANS_DIR, f), 'utf8').split('\n').filter(Boolean).slice(0, 3).join(' / ');
        return `| ${id} | ${v.durationMmss || '—'} | ${fmtNum(v.digg) || '—'} | ${first.slice(0, 90)} |`;
      }),
    ]);
    P(`> **开场模板判断依据**：给世界观＝时代宣言；借热度＝热度播报；先共鸣后抖包袱＝感悟开场。把这一列归类，就是你账号可以直接复用的开场库。`);
  }
}

// ============ 评论模式 ============
if (MODE === 'comments' || C.length) {
  H('九、评论区：观众在关心什么');
  if (!C.length) {
    P('（本批数据没有评论。用 `comments.js` 在视频页采集）');
  } else {
    const authorName = (D.authors || [])[0]?.name || '';
    const cls = classifyComments(C, authorName);

    P(`> **判读原则**：有效 ≠ "提问"，而是**含信息增量**。「求邀请码」和「为什么我的也转圈圈了」都是提问，但后者含可验证的失败细节，前者没有。`);
    P('');
    B([
      `| 层级 | 内容 | 条数 | 用途 |`,
      `|---|---|---|---|`,
      `| **S 观点型** | 含矛盾 / 专业约束 / 反向主张，且给了理由 | ${cls.S.length} | **直接做选题**，标题常藏在原话里 |`,
      `| **A 细节型** | 含可验证的具体细节（行话、版本、失败场景） | ${cls.A.length} | 挖干货内容 |`,
      `| **B 资源型** | 求邀请码 / 求链接 / 求名额 | ${cls.B.length} | **运营信号，不是选题**——只用来判断需求强度 |`,
      `| **C 噪声** | 作者自己的回复、灌水、纯表情、过短 | ${cls.noise} | 丢弃 |`,
      `| 合计 | | ${C.length} | |`,
    ]);
    if (cls.resourceCount) {
      const rate = ((cls.resourceCount / C.length) * 100).toFixed(1);
      P(`**资源索取占 ${rate}%**（${cls.resourceCount}/${C.length}）。这个比例说明观众卡在**入口**而不是**方法**——` +
        `对创作者意味着：他们的内容已经把需求激发出来了，但交付链路断在"拿不到"。这是运营问题，不是内容问题。`);
    }

    H('十、高频意群（观众自己的用词）');
    const effective = C.filter((c) => !isJunk(c.text) && !RESOURCE_RE.test(String(c.text).replace(/\s+/g, '')));
    const ck = keywords((effective.length >= 20 ? effective : C).map((c) => c.text), 30);
    P(ck.map(([w, c]) => `\`${w}\`(${c})`).join('　') || '（样本不足）');
    P(`> 已滤掉灌水与资源索取，剩下的是**观众真正在讨论的内容**。这些词直接写进标题，比自造词更贴近搜索。`);

    H('十一、可直接做选题的评论（S 层 + A 层）');
    if (cls.S.length) {
      P('### S 层：观点型（信息量最高）');
      P(`> 评分维度：矛盾(+5) / 细节(+3) / 反向(+2) / 有理由(+2) / 长文(+2)。标签写在每条前面。`);
      P('');
      cls.S.slice(0, 15).forEach((c) => {
        P(`- **${c._score}分** [${(c._tags || []).join('+')}]${c.digg ? ` [${fmtNum(c.digg)}赞]` : ''}${c.count > 1 ? ` [共${c.count}条]` : ''}`);
        P(`  > ${c.sample ? c.sample : c.text}`);
      });
      P('');
      P(`**怎么用**：S 层里带 \`矛盾\` 标签的，可以直接做成"我知道你在想什么"的回应期；带 \`细节\` 的，是干货选题；两种都有（S+）的，是第一期首选。`);
    }
    if (cls.A.length) {
      P('');
      P('### A 层：细节型（可挖干货）');
      cls.A.slice(0, 15).forEach((c) => {
        P(`- [${(c._tags || []).join('+')}]${c.digg ? ` [${fmtNum(c.digg)}赞]` : ''} ${(c.sample || c.text).slice(0, 110)}`);
      });
    }

    H('十二、资源型需求（运营信号，别当选题）');
    if (cls.B.length) {
      B([
        `| 诉求 | 出现次数 | 代表原话 |`,
        `|---|---|---|`,
        ...cls.B.slice(0, 10).map((c) => `| ${(c.sample || c.text).slice(0, 30)} | ${c.count} | ${(c.sample || c.text).slice(0, 40)} |`),
      ]);
      P(`> **这些不是选题**。做成视频只会变成导流/发码，而且会被平台判定为引流。` +
        `正确用法：① 作为**需求强度证据**（多少人卡在入口）；② 设计成**互动装置**（"评论区留言我发你"）；③ 反过来做一期"拿不到邀请码时怎么办"——把索取转成内容。`);
    } else {
      P('（本批没有资源型需求）');
    }

    H('十三、高频评论 TOP 20（代表沉默大多数）');
    P(`> 注意：高赞 ≠ 高价值。榜单里经常是"求码"和情绪表达，选选题请看第九节，不要看这里。`);
    C.slice().sort((a, b) => (b.digg || 0) - (a.digg || 0)).slice(0, 20)
      .forEach((c) => P(`- [${fmtNum(c.digg) || 0}赞] ${c.isAuthor ? '【作者】' : ''}${c.text.slice(0, 90)}`));

    H('十四、怎么把评论变成选题');
    B([
      `| 评论信号 | 定性 | 对应动作 |`,
      `|---|---|---|`,
      `| 指出"你说的 vs 你做的"不一致 | S（矛盾） | 最强的钩子。必须正面回应，标题就用他的原话 |`,
      `| 出现行话/具体约束（费片率、算力、报错） | S/A（细节） | 挖一期干货，把约束条件讲透 |`,
      `| 明确说"没用/智商税"并给了理由 | S（反向） | 做"我知道你在想什么"，先把反对意见念出来 |`,
      `| 讲了自己的失败经历 | A（细节） | 当案例（打码）做进下一期 |`,
      `| 求邀请码/链接/名额 | B（资源） | **不是选题**。做互动装置，或反过来做"拿不到怎么办" |`,
      `| 灌水、夸、作者自己的回复 | C（噪声） | 丢弃 |`,
    ]);
  }
}

// ---------- 输出 ----------
ensureDir(path.dirname(OUT));
const text = md.join('\n');
fs.writeFileSync(OUT, text, 'utf8');

console.log(`[analyze] mode=${MODE} videos=${V.length} comments=${C.length}`);
console.log(`[analyze] report -> ${OUT}`);
console.log(`[analyze] lines=${text.split('\n').length} chars=${text.replace(/\s/g, '').length}`);
