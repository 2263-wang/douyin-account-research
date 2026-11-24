# douyin-account-research

抖音账号与选题调研 skill。三个模式：**选题调研**、**对标账号分析**、**评论区选题挖掘**。

## 定位

**采集层复用已有的 `dsh-browser` 工具链，本 skill 只负责编排和分析**——那是工具链没有的部分。

```
dsh-browser（采集，已存在）        douyin-account-research（分析，本 skill）
  launch.ps1        起浏览器         run.mjs           三模式编排
  crawl.js          关键词搜索       lib/adapt.mjs     统一各种输出形状
  vsrch.js          按视频搜         analyze.mjs       分析引擎 → Markdown
  find.js           按用户搜         fetch-detail.mjs  详情接口精采（拿工具链拿不到的字段）
  works.js          账号主页         transcribe.mjs    抽音轨 + 转写 → 逐字稿
  batch-works.js    批量账号
  vstats.js         逐条真实互动
  dates.js          发布日期
  engagement.js     互动四件套
  comments.js       评论
  merge-search.js   合并搜索
  candidates.js     候选池
  rank.js           候选排序
```

## 三种模式怎么用

```powershell
# 选题调研
node scripts/run.mjs --mode topic --keyword "AI编程"
node scripts/analyze.mjs --mode topic --data data/run/normalized.json --report "报告-选题.md"

# 对标账号
node scripts/run.mjs --mode account --account "https://www.douyin.com/user/xxx"
node scripts/analyze.mjs --mode account --data data/run/normalized.json --report "报告-账号.md"

# 评论区选题
node scripts/run.mjs --mode comments --works works-xxx.json
node scripts/analyze.mjs --mode comments --data data/run/normalized.json --report "报告-评论.md"
```

在 Codex 里直接说需求也会触发，例如「帮我调研『Claude Code』这个选题在抖音的情况」「分析这个账号 <链接>」「看看这条视频的评论区，帮我找选题」。

**首次使用需要你配合**：在弹出的浏览器窗口里扫码登录（建议小号），并打开目标页面。

## 为什么需要浏览器

抖音的搜索结果和详情接口需要登录态 + 签名。实测过三条路：

| 做法 | 结果 |
|---|---|
| httpx / Invoke-WebRequest 直接请求 | HTTP 200 但返回**空壳**，可见文本 0 字 |
| headless 浏览器 | 渲染成功，但服务端返回**"验证码中间页"** |
| **可见窗口 + 人工登录** | 通 |

所以采集层驱动的是真实浏览器：真实鼠标点击搜索框、逐字符输入、随机间隔、滚动加载。详见 `REFERENCES.md`。

## 依赖

- **Node.js ≥ 18**（内置 WebSocket/fetch，**无需 npm install**）
- **Chrome 或 Edge**（采集层驱动真实浏览器）
- **ffmpeg**、**ffprobe**（转写用）：`winget install Gyan.FFmpeg`
- **Python 3**（转写用）：`pip install faster-whisper opencc-python-reimplemented`
- **dsh-browser 工具链**

### 工具链位置解析顺序

`run.mjs` 按这个顺序找工具链，**换电脑时不用改代码**：

1. `--toolkit <目录>` 参数
2. 环境变量 `DSH_TOOLKIT`
3. **skill 目录下的 `toolkit/`** ← 分发包自带的形态
4. 历史位置（开发机）`<工作区>/dsh-browser`
5. 当前工作目录下的 `dsh-browser` 或 `toolkit`

分发包形态（`douyin-account-research/toolkit/`）开箱即用；如果你把工具链放在别处，`set DSH_TOOLKIT=<目录>` 即可。

### 自检

```powershell
powershell -File verify-env.ps1
```

## 数据能拿到什么

| 数据 | 能拿 | 说明 |
|---|---|---|
| 作品列表、标题、点赞、时长、发布日期 | ✅ | 主页 + 逐条详情 |
| 评论（正文/时间/地区/点赞） | ✅ | 滚动加载 |
| 分享数、收藏数 | 部分 | 收藏数 DOM 上没有，需走 `fetch-detail.mjs` |
| 逐字稿 | ✅ | 抽音频 → faster-whisper（CPU 约 2.6 倍速） |
| **播放量、完播率** | ❌ | 接口不返回，**报告里不会编** |

## 边界

- 不做批量抓取、不构造带签名的请求、不绕过验证码
- 只下载音频用于转写分析，不下载视频原件、不再分发
- 分析完删除音频等中间产物（`data/audio`）

详见 `SKILL.md` 的「铁律」与 `REFERENCES.md`。
