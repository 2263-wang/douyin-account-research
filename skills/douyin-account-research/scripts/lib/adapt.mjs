// 适配层：把 dsh-browser 工具链的各种输出形状，统一成分析引擎吃的结构
//
// 支持的输入形状：
//   works-*.json        账号主页抓取（profile + items）
//   vstats-*.json       逐条视频的真实互动（results: digg/comment/publishTime）
//   comments-*.json     评论（videos[].comments[]）
//   search-merged.json  关键词搜索结果合并（videos / accounts / allVideos）
//   engagement.json     互动四件套（results: digg/comment/collect/share）
//   authors.json        视频 -> 作者
//   clicksearch-*.json  单次搜索的卡片（cards）
import fs from 'node:fs';
import path from 'node:path';

/** "13.1万" -> 131000 */
export function parseCN(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  const m = String(s).match(/([\d.]+)\s*(万|亿)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  if (m[2] === '万') return Math.round(n * 10000);
  if (m[2] === '亿') return Math.round(n * 100000000);
  return Math.round(n);
}

const secToMmss = (sec) => {
  if (sec == null) return '';
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const durToSec = (d) => {
  if (!d) return null;
  const p = String(d).split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

/**
 * 工具链的 comments.js 把整块 innerText 塞进 text，形如：
 *   "云淡风清 ... 其实我一直觉得 ... 1月前·广东 99 分享 回复"
 * 这里把它拆回：正文 / 时间 / 地区 / 点赞。
 * 结构不稳定，解析失败就保留原文，绝不编造。
 */
export function parseComment(raw) {
  let t = String(raw || '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 去掉尾部的"分享 回复 举报"以及"展开N条回复 / 收起"这类控件文字
  t = t.replace(/(?:\s*(?:分享|回复|举报|展开\d*条回复|展开更多|收起))+$/g, '').trim();

  let ip = null, relTime = null, likes = null;

  // 时间·地区（抖音网页版固定格式）
  const mTime = t.match(/(\d+[秒分时天周月]前|昨天|\d{1,2}-\d{1,2}|\d{4}-\d{1,2}-\d{1,2})/);
  if (mTime) {
    relTime = mTime[1];
    const after = t.slice(mTime.index + mTime[1].length);
    const mIp = after.match(/^[·\s]*([\u4e00-\u9fa5]{2,8}?)(?=\s|$)/);
    if (mIp) ip = mIp[1];
  } else {
    const mIp = t.match(/([\u4e00-\u9fa5]{2,8})\s*$/);
    if (mIp) ip = mIp[1];
  }

  // 正文 = 时间·地区之前的部分；点赞数在"时间·地区"之后
  let body = t;
  if (mTime) {
    const idx = t.indexOf(mTime[1]);
    const lastSep = t.lastIndexOf('·', idx);           // "3周前·广西" 的 · 在时间之后
    const tail = t.slice(idx);
    // 时间后面紧跟的纯数字就是点赞数（如 "3周前·广西 11"）
    const mLike = tail.match(/^(?:\s*·?\s*[\u4e00-\u9fa5]{0,8})?\s*(\d+(?:\.\d+)?万?)\s*$/);
    if (mLike) likes = parseCN(mLike[1]);
    body = t.slice(0, idx);
    if (body.endsWith('·')) body = body.slice(0, -1);
  }
  // 开头的"昵称 ..."（抖音用三个点占位，也可能是 · 或 …）
  body = body.replace(/^.{1,28}?(?:\.{2,}|…|·{1,2})\s*/, '').trim();
  if (!body) body = t;   // 没匹配上就用原文，宁可吵也不要丢

  return { text: body, ip, relTime, likes };
}

/**
 * 工具链的 works.js / vstats.js 把整块卡片文本放在 raw 里，
 * 形如 "295 3个Skill，把书变成你的专属知识库: ...#AI工作流 #AI"，
 * 开头那个数字是点赞数（或播放量），后面才是文案。desc 字段常常是空的。
 * 置顶作品的 raw 会以"置顶"开头。
 */
export function parseRawCard(raw, fallback = '') {
  let t = String(raw || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return { desc: fallback, leadNumber: null, pinned: false };
  const pinned = /^置顶/.test(t);
  if (pinned) t = t.replace(/^置顶\s*/, '');
  const m = t.match(/^([\d.]+万?)\s+(.*)$/);
  if (m) return { desc: m[2].trim(), leadNumber: parseCN(m[1]), pinned };
  return { desc: t, leadNumber: null, pinned };
}

/** vstats 的 bodySample 里含播放器时长，形如 "00:03 / 20:59" */
export function parseDurationFromBody(body) {
  const m = String(body || '').match(/\d{1,2}:\d{2}\s*\/\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
  return m ? durToSec(m[1]) : null;
}

export function emptyState() {
  return { generatedAt: new Date().toISOString(), sources: [], videos: [], comments: [], authors: [], notes: [] };
}

const upsertVideo = (state, v) => {
  if (!v.awemeId) return;
  // 注意：不能用 `v.x ?? prev.x`——对象展开后 v.x 可能是 undefined 而把它当成"有值"覆盖掉。
  // 必须显式判断 != null 才采用新值。
  const keep = (nv, pv) => (nv != null ? nv : pv);
  const i = state.videos.findIndex((x) => x.awemeId === v.awemeId);
  if (i >= 0) {
    const prev = state.videos[i];
    state.videos[i] = {
      ...prev, ...v,
      desc: v.desc || prev.desc,
      author: v.author || prev.author,
      digg: keep(v.digg, prev.digg),
      comment: keep(v.comment, prev.comment),
      collect: keep(v.collect, prev.collect),
      share: keep(v.share, prev.share),
      durationSec: keep(v.durationSec, prev.durationSec),
      publishedAt: v.publishedAt || prev.publishedAt,
      pinned: v.pinned ?? prev.pinned,
      sources: [...new Set([...(prev.sources || []), ...(v.sources || [])])],
    };
  } else {
    state.videos.push({ ...v, sources: v.sources || [] });
  }
};

/**
 * 账号信息合并。注意：同一个账号可能从不同来源拿到不同的"name"——
 * 主页抓取拿到的是抖音号（一串数字），详情接口拿到的是昵称（中文名）。
 * 所以必须**先按 secUid 合并**，否则会出现同一账号两条记录。
 * 合并时优先保留看起来像昵称的那个 name（纯数字的抖音号排在后面）。
 */
const looksLikeHandleId = (n) => /^\d{6,}$/.test(String(n || '').trim());

const upsertAuthor = (state, a) => {
  if (!a?.name && !a?.secUid) return;
  // 先按 secUid 找，再退回按 name 找
  let i = a.secUid ? state.authors.findIndex((x) => x.secUid && x.secUid === a.secUid) : -1;
  if (i < 0 && a.name) i = state.authors.findIndex((x) => x.name === a.name);

  if (i < 0) { state.authors.push({ ...a }); return; }

  const prev = state.authors[i];
  // name：昵称优先于纯数字抖音号
  let name = prev.name;
  if (a.name) {
    if (!name || (looksLikeHandleId(name) && !looksLikeHandleId(a.name))) name = a.name;
  }
  state.authors[i] = {
    ...prev, ...a,
    name,
    secUid: a.secUid || prev.secUid || '',
    signature: a.signature || prev.signature || '',
    followerCount: a.followerCount ?? prev.followerCount ?? null,
    totalFavorited: a.totalFavorited ?? prev.totalFavorited ?? null,
    awemeCount: a.awemeCount ?? prev.awemeCount ?? null,
  };
};

/** 判断一个 JSON 属于哪种形状 */
export function detectShape(j) {
  // 详情接口：字段最全（含收藏数），优先级最高
  if (j?.aweme_detail && typeof j.aweme_detail === 'object') return 'detail';
  if (j?.profile && Array.isArray(j.items)) return 'works';
  // batch-works.js / batch-ai.js：results[] 里每个元素含 profile + items
  if (Array.isArray(j?.results) && j.results[0]?.profile && Array.isArray(j.results[0]?.items)) return 'batchWorks';
  // dates.js / dates-full.js / *-classified.json：results[] 含 published/rel
  if (Array.isArray(j?.results) && j.results[0]?.published !== undefined) return 'dates';
  // classify.js 输出
  if (Array.isArray(j?.scored) && j.scored[0]?.published !== undefined) return 'dates';
  // vstats 必须排在 engagement 前面判断：两者都有 results[].digg，
  // 但 vstats 独有 publishTime/bodySample，判晚了就会被当成 engagement 而丢掉日期
  if (Array.isArray(j?.results) && j.results[0]?.publishTime !== undefined) return 'vstats';
  if (Array.isArray(j?.results) && j.results[0]?.bodySample !== undefined) return 'vstats';
  if (Array.isArray(j?.results) && j.results[0]?.digg !== undefined) return 'engagement';
  if (Array.isArray(j?.results) && j.results[0]?.authorSec !== undefined) return 'authors';
  if (Array.isArray(j?.videos) && j.videos[0]?.comments) return 'comments';
  if (Array.isArray(j?.allVideos) || Array.isArray(j?.accounts)) return 'searchMerged';
  if (Array.isArray(j?.cards)) return 'clicksearch';
  return 'unknown';
}

export function adaptFile(state, file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 'unreadable'; }
  const shape = detectShape(j);
  state.sources.push({ file: path.basename(file), shape });

  switch (shape) {
    // 详情接口（fetch-detail.mjs 产出）：字段最全
    case 'detail': {
      const a = j.aweme_detail;
      const v = a.video || {};
      upsertVideo(state, {
        awemeId: String(a.aweme_id),
        desc: (a.desc || '').replace(/\s+/g, ' ').trim(),
        tags: (a.text_extra || []).map((t) => t.hashtag_name).filter(Boolean).join(' '),
        author: a.author?.nickname || '',
        authorId: a.author?.sec_uid || '',
        digg: a.statistics?.digg_count ?? null,
        comment: a.statistics?.comment_count ?? null,
        collect: a.statistics?.collect_count ?? null,
        share: a.statistics?.share_count ?? null,
        durationSec: v.duration ? Math.round(v.duration / 1000) : null,
        publishedAt: a.create_time ? new Date(a.create_time * 1000).toISOString().slice(0, 10) : '',
        isImage: !!(a.images && a.images.length),
        sources: ['detail'],
      });
      // 详情里的作者信息比主页卡片可靠
      if (a.author?.nickname) {
        const key = a.author.sec_uid || a.author.uid || a.author.nickname;
        const prev = state.authors.find((x) => x.secUid === key || x.name === a.author.nickname) || {};
        upsertAuthor(state, {
          name: a.author.nickname,
          secUid: a.author.sec_uid || prev.secUid || '',
          signature: a.author.signature || prev.signature || '',
          followerCount: a.author.follower_count ?? prev.followerCount ?? null,
          totalFavorited: a.author.total_favorited ?? prev.totalFavorited ?? null,
          awemeCount: a.author.aweme_count ?? prev.awemeCount ?? null,
        });
      }
      return shape;
    }
    case 'works': {
      const p = j.profile || {};
      upsertAuthor(state, {
        name: p.title?.replace(/的抖音.*$/, '') || p.handle || '未知账号',
        secUid: (j.page || '').split('/user/')[1] || '',
        signature: p.bio || '',
        followerCount: parseCN(p.fans),
        totalFavorited: parseCN(p.likes),
        following: parseCN(p.following),
        awemeCount: p.worksCount ? Number(p.worksCount) : null,
      });
      const authorName = state.authors[state.authors.length - 1]?.name || '';
      for (const it of j.items) {
        const card = parseRawCard(it.raw, it.title || '');
        upsertVideo(state, {
          awemeId: it.id,
          desc: card.desc || it.title || '',
          author: authorName,
          digg: parseCN(it.play) ?? card.leadNumber,   // 主页卡片上显示的是点赞数
          durationSec: durToSec(it.dur),
          // run.mjs 的 --days 时间窗会给 items 补 date 字段
          publishedAt: it.date || '',
          isImage: false,
          sources: ['works'],
        });
      }
      return shape;
    }
    case 'vstats': {
      for (const r of j.results) {
        const card = parseRawCard(r.raw, r.desc || r.title || '');
        upsertVideo(state, {
          awemeId: r.id,
          desc: card.desc,
          pinned: card.pinned || undefined,
          digg: parseCN(r.digg) ?? card.leadNumber ?? parseCN(r.play),
          comment: parseCN(r.comment),
          share: parseCN(r.share),
          publishedAt: (r.publishTime || r.dateText || r.date || '').slice(0, 10),
          // 时长工具链的 dur 常为空，但 bodySample 里有播放器时间 "00:03 / 20:59"
          // 时长优先用 vstats 抓到的精确秒数（<video>.duration），
          // 其次 dur/durText，最后从 bodySample 的 "00:03 / 20:59" 里解析
          durationSec: r.durationSec ?? durToSec(r.dur) ?? durToSec(r.durText) ?? parseDurationFromBody(r.bodySample),
          sources: ['vstats'],
        });
      }
      return shape;
    }
    case 'engagement': {
      for (const r of j.results) {
        upsertVideo(state, {
          awemeId: r.id,
          desc: r.title || '',
          digg: parseCN(r.digg),
          comment: parseCN(r.comment),
          collect: parseCN(r.collect),
          share: parseCN(r.share),
          sources: ['engagement'],
        });
      }
      return shape;
    }
    case 'authors': {
      for (const r of j.results) {
        upsertAuthor(state, { name: r.authorText || r.authorSec || '', secUid: r.authorSec || '' });
        upsertVideo(state, { awemeId: r.videoId, author: r.authorText || '', desc: r.title || '', sources: ['authors'] });
      }
      return shape;
    }
    case 'comments': {
      const seenC = new Set();   // 工具链每个视频会重复采到相同评论，必须去重
      for (const v of j.videos) {
        const id = (v.videoUrl || '').split('/video/')[1] || '';
        for (const c of v.comments || []) {
          const parsed = parseComment(c.text);
          const key = `${c.author || ''}|${parsed.text.slice(0, 60)}`;
          if (seenC.has(key)) continue;
          seenC.add(key);
          state.comments.push({
            cid: `${id}-${state.comments.length}`,
            awemeId: id,
            text: parsed.text,
            digg: parseCN(c.like) ?? parsed.likes ?? null,
            ip: parsed.ip || '',
            relTime: parsed.relTime || '',
            user: c.author || '',
            isAuthor: false,
            videoTitle: v.title || '',
            videoPlay: v.play ?? null,
          });
        }
      }
      return shape;
    }
    // batch-works.js / batch-ai.js：一次抓多个账号
    case 'batchWorks': {
      for (const r of j.results || []) {
        if (r.ok === false) continue;
        const p = r.profile || {};
        upsertAuthor(state, {
          name: (p.title || '').replace(/的抖音.*$/, '') || r.sec || '未知账号',
          secUid: r.sec || '',
          signature: p.bio || '',
          followerCount: parseCN(p.fans),
          totalFavorited: parseCN(p.likes),
          following: parseCN(p.following),
          awemeCount: p.worksCount ? Number(p.worksCount) : null,
        });
        const name = (p.title || '').replace(/的抖音.*$/, '') || r.sec || '';
        for (const it of r.items || []) {
          upsertVideo(state, {
            awemeId: it.id,
            desc: it.title || '',
            author: name,
            digg: parseCN(it.play),
            durationSec: durToSec(it.dur),
            sources: ['batchWorks'],
          });
        }
      }
      return shape;
    }
    // dates.js / dates-full.js / *-classified.json：发布日期（字段是 abs，不是 published）
    case 'dates': {
      const list = j.results || j.scored || [];
      for (const r of list) {
        upsertVideo(state, {
          awemeId: String(r.id),
          desc: r.title || '',
          digg: parseCN(r.playN ?? r.play),
          publishedAt: String(r.abs || r.published || '').slice(0, 10),
          relativeDate: r.rel || '',
          publishKind: r.kind || '',
          sources: ['dates'],
        });
      }
      return shape;
    }
    case 'searchMerged': {
      for (const v of j.allVideos || j.videos || []) {
        upsertVideo(state, {
          awemeId: String(v.id),
          desc: v.title || '',
          author: v.handle || '',
          digg: parseCN(v.play),
          keyword: v.keyword || '',
          sources: ['searchMerged'],
        });
      }
      for (const a of j.accounts || []) {
        upsertAuthor(state, { name: a.handle, videoCount: a.videoCount, medianDigg: a.median, maxDigg: a.max, keywords: a.keywords });
      }
      return shape;
    }
    case 'clicksearch': {
      for (const c of j.cards || []) {
        upsertVideo(state, { awemeId: String(c.id), desc: c.text || '', sources: ['clicksearch'] });
      }
      return shape;
    }
    default:
      return shape;
  }
}

/** 扫描目录（或单文件）并适配全部输入 */
export function adaptPaths(state, inputs) {
  const files = [];
  for (const inp of inputs) {
    const p = path.resolve(inp);
    if (!fs.existsSync(p)) { state.notes.push(`输入不存在: inp`); continue; }
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) if (f.endsWith('.json')) files.push(path.join(p, f));
    } else files.push(p);
  }
  const shapes = {};
  for (const f of files) {
    const s = adaptFile(state, f);
    shapes[s] = (shapes[s] || 0) + 1;
  }
  // 派生字段
  for (const v of state.videos) {
    v.durationMmss = v.durationSec != null ? secToMmss(v.durationSec) : (v.durationMmss || '');
    v.diggText = v.digg != null ? String(v.digg) : '';
    v.collectRate = v.digg && v.collect != null ? +(v.collect / v.digg).toFixed(3) : null;
    v.commentRate = v.digg && v.comment != null ? +(v.comment / v.digg).toFixed(3) : null;
    v.shareRate = v.digg && v.share != null ? +(v.share / v.digg).toFixed(3) : null;
  }
  state.videos.sort((a, b) => (b.digg ?? -1) - (a.digg ?? -1));
  return { files: files.length, shapes };
}
