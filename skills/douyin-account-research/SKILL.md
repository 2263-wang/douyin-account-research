---
name: douyin-account-research
description: 抖音账号与选题调研。三种模式：①给定选题，搜集抖音及相关平台的同类视频内容与表现数据；②给定对标账号，分析其内容框架、发布节奏、标题逻辑与用户画像；③从对标账号或同赛道视频的评论区挖掘用户真实关切，产出可直接拍的选题清单。复用已有的 dsh-browser CDP 工具链采集，产出竞品数据表、Markdown 分析报告与爆款逐字稿。当用户提到"抖音选题""对标账号""评论区找选题""账号分析""爆款拆解""帮我看看这个号"时使用。
---

# 抖音账号与选题调研

## 跨平台支持

全部脚本用 Node 写，**Windows / macOS / Linux 通用**。浏览器自动定位（Chrome / Edge / Chromium / Brave），装在哪都能找到；不认的路径用环境变量指定：

```bash
# Windows
set DSH_BROWSER=D:\path\to\chrome.exe
# macOS / Linux
export DSH_BROWSER=/path/to/chrome
```

| 功能 | Windows | macOS / Linux |
|---|---|---|
| 启动浏览器 | `node scripts/launch.mjs` | 同左（另有 `toolkit/launch.sh` 包装） |
| 环境自检 | `node scripts/verify-env.mjs` | 同左 |
| 关闭浏览器 | `node scripts/close-browser.mjs` | 同左 |
| 采集与分析 | 全部 Node，一致 | 一致 |

> `toolkit/launch.ps1` 也保留着，Windows 上可直接用；它是 ASCII-only 的（PS 5.1 的 GBK 问题）。
> `verify-env.ps1` 是 Windows 专用版本，其他平台请用 `scripts/verify-env.mjs`。

## 架构：两层，不要重复造轮子

```
采集层：dsh-browser 工具链（已存在，直接用，别重写）
        launch.ps1 / click-search.js / crawl.js / vsrch.js / find.js
        works.js / batch-works.js / vstats.js / dates.js / engagement.js
        comments.js / merge-search.js / candidates.js / rank.js / discover.js

分析层：本 skill（采集层没有的能力）
        run.mjs          三个模式的编排器
        lib/adapt.mjs    把工具链的各种输出形状统一
        analyze.mjs      分析引擎 -> Markdown 报告
        fetch-detail.mjs 详情/评论接口精采（工具链拿不到的字段）
        transcribe.mjs   抽音轨 + 转写 -> 逐字稿
```

**铁律：能调工具链就不要写新采集器。** 工具链已经处理过登录、真实鼠标键盘事件、人类节奏、DOM 结构适配；重写一套只会重复踩坑。

工具链位置解析顺序：`--toolkit <目录>` → 环境变量 `DSH_TOOLKIT` → 工作区里的 `dsh-browser`。

## 三个模式

| 用户给什么 | 模式 | 一条命令 |
|---|---|---|
| 一个选题关键词 | topic | `node scripts/run.mjs --mode topic --keyword "AI编程"` |
| 一个账号（主页链接或 secUid） | account | `node scripts/run.mjs --mode account --account <secUid或URL>` |
| 一批视频（含评论） | comments | `node scripts/run.mjs --mode comments --works works-xxx.json` |

然后出报告：

```powershell
node scripts/analyze.mjs --mode topic    --data data/run/normalized.json --report "报告-选题调研.md"
node scripts/analyze.mjs --mode account  --data data/run/normalized.json --report "报告-对标账号.md"
node scripts/analyze.mjs --mode comments --data data/run/normalized.json --report "报告-评论选题.md"
```

## 标准流程

### 第 0 步：环境自检（先跑，别凭印象说"没有"）

```bash
node scripts/verify-env.mjs
```

检查 Node、浏览器（会列出查过哪些路径）、ffmpeg、Python 依赖，并报出工具链位置。

缺什么装什么：`pip install faster-whisper opencc-python-reimplemented`；
ffmpeg：Windows `winget install Gyan.FFmpeg` / macOS `brew install ffmpeg` / Linux 用发行版包管理器。

> Windows 上另有 `verify-env.ps1`（PS 版）；**其他平台用 `scripts/verify-env.mjs`**，跨平台。

### 第 1 步：起浏览器并登录（每次会话一次）

```bash
node scripts/launch.mjs          # 三平台通用：定位浏览器 → 独立 profile 启动 → 等端口就绪
```

**请用户在那个窗口里扫码登录（建议小号）。** 必须可见窗口——headless 会被判定为自动化客户端。

确认通道：

```bash
node -e "fetch('http://127.0.0.1:9222/json/list').then(r=>r.json()).then(t=>t.filter(x=>x.type==='page').forEach(x=>console.log(x.url)))"
```

> 便利入口：Windows `powershell -File toolkit/launch.ps1`；macOS/Linux `bash toolkit/launch.sh`。两者最终都调用同一个 `scripts/launch.mjs`。

#### 浏览器生命周期：脚本自己负责收尾

**这条不用你记，但要知道行为**：

| 脚本 | 浏览器不在跑时 | 跑完 |
|---|---|---|
| `run.mjs` | 自己不管，会用现有浏览器 | **自动关** |
| `fetch-detail.mjs` / `resolve-share.mjs` | **自动起一个**（并等页面就绪） | **自动关** |
| `launch.mjs` | —（它就是启动器） | **不关**（等你去扫码登录） |
| `transcribe.mjs` | 不需要浏览器 | — |

**想保留浏览器就加 `--keep-browser`。** 手动关：`node scripts/close-browser.mjs`。

> 这个设计是踩坑改出来的：之前只有 `run.mjs` 会关，跑 `launch.mjs` 取详情、再跑转写，浏览器就一直留在桌面上。
> 现在 `fetch-detail` / `resolve-share` 会自管生命周期，并在起浏览器后**等页面落到 douyin.com 再动手**——否则会报 `Failed to fetch`。

### 第 2 步：跑对应模式的采集

```powershell
# 看要执行哪些步骤（不实际执行）
node scripts/run.mjs --mode topic --keyword "AI编程" --dry

# 实际执行；--only/--skip 可单步跑
node scripts/run.mjs --mode topic --keyword "AI编程" --only search,merge
```

### 第 3 步（可选，要逐字稿时）：精采详情 + 转写

工具链只读渲染后的 DOM，**拿不到播放地址、音乐地址、收藏数**；这些要调详情接口：

```powershell
# 在已登录的浏览器里同源 fetch 详情接口
node scripts/fetch-detail.mjs --ids 7263959425499613218,7298145681699622182

# 抽音轨并转写（CPU 约 2.6 倍速）
node scripts/transcribe.mjs --limit 5 --model small --device cpu

# 繁转简
python scripts/to-simplified.py data/transcripts/*.txt
```

### 第 4 步：出报告并解读

报告是骨架 + 数据表，**判断要你自己写**。写法见 [EXAMPLES.md](EXAMPLES.md)。

## 各模式的采集链（run.mjs 里的定义）

**topic**：`crawl.js search <关键词>` → `merge-search.js` → `candidates.js` → `rank.js` → `batch-works.js` → `engagement.js` → `comments.js`

**account**：`works.js <账号>` → `vstats.js` → `dates.js` → `comments.js`

**comments**：`comments.js <works.json>`

## 分析时要回答的问题

**选题模式**
- **供给缺口**：看时长分桶——哪个区间"条数少、点赞中位数高"，那是机会位。
- **工具型还是情绪型**：收藏/点赞 >0.3 是工具型（观众要回头照着做），0.05–0.15 是娱乐型。
- **金句归属**：逐字稿里多账号共用的句子是"素材自带的传播力"，可以借结构、换赛道。
- **开场模板**：给世界观＝时代宣言；借热度＝热度播报；先共鸣后抖包袱＝感悟开场。三种都爆过说明模板无优劣，只匹配账号人格。

**账号模式**
- **内容类型 × 表现（这一节最重要）**：报告第五节把作品按内容类型归类，交叉出"哪一类在涨、哪一类在跌"。
  - 看三个数：**点赞中位数**（流量主力）、**藏/赞**（观众觉得"以后用得上"）、**分/赞**（观众愿意转给别人）
  - **收藏最高的类型 ≠ 转发最高的类型**是常态。按目的选类型：要涨粉做转发率高的那类，要沉淀做收藏率高的那类
  - 分类是关键词启发式，**实测准确率约 79%**；报告给出每类代表作与命中词，供人工复核
  - **未分类超过 20% 会告警**——说明该账号内容超出通用类型表，要在 `lib/content-type.mjs` 里按它补规则
  - 分类**只吃标题文案，不吃话题标签**（标签是噪声：`#大模型架构` 会把"Claude 领先 GPT"误判成原理科普）
- **内容框架**：时长中位数、系列化程度、发的是观点还是清单。
- **发布节奏**：日更还是周更？哪几天发得多、哪天表现最好？
- **标题逻辑**：开头高频词是提问式、宣言式还是清单式？
- **可复制 vs 不可复制**：结构可抄（开场、节奏、清单形态），人格不可抄（口音、经历、出镜形象）。这一节必须写，否则报告等于没写。

**评论模式**
报告先把评论分成四层，**这是最容易做错的一步**：

> **有效 ≠ "提问"，而是"含信息增量"。**
> 「如何获取邀请码呢？」和「为什么我的也转圈圈了」都是提问，但后者含可验证的失败细节，前者没有。

| 层 | 内容 | 怎么用 |
|---|---|---|
| **S 观点型** | 含矛盾/专业约束/反向主张，**且给了理由** | 直接做选题，标题常藏在原话里 |
| **A 细节型** | 含可验证的具体细节（行话、版本、失败场景） | 挖干货 |
| **B 资源型** | 求邀请码/求链接/求名额 | **运营信号，不是选题**——它衡量需求强度，做成视频只会变成导流 |
| **C 噪声** | 作者自己的回复、灌水、纯表情、过短 | 丢弃 |

**最强的一类是"矛盾"**：观众用你内容里的主张反驳你的做法（如"你说 AI 视频这么牛，为什么你自己还手搓？"）。这种必须正面回应，而且标题就是原话。

**高赞 ≠ 高价值**：高赞榜里常见"求码"和情绪表达。实测某账号价值最高的一条评论（9 分）不在高赞前列。**选选题看第九节，不要看第十一节的高赞榜。**

**高频意群那一节是观众的原始语言**，直接写进标题比自造词更贴近搜索和推荐。注意它的局限：统计的是"整句复现"而非词频，某个词若只出现在长句里会被整句吸收；要看精确词频就人工扫第九节的原话列表。

## 报告的硬性要求

1. **必须标注数据来源与局限**：抖音接口不返回播放量和完播率，任何相关结论都不能编。样本量小时明说"样本 N 条，仅作方向参考"。
2. **每条表格后面必须有一句"所以呢"**，不能只贴数字。
3. **区分一手与二手**：工具链采的是你自己登录态下渲染出的数据；其他平台（B站/小红书）的数据是公开可见信息，注明"未经接口核验"。

## 交付前清理

```bash
# 中间产物（音频、原始抓包）
rm -rf data/audio          # Windows: Remove-Item data\audio -Recurse -Force

# 关闭本工具链的浏览器（三平台通用，只按 profile 路径匹配，不碰用户自己的浏览器）
node scripts/close-browser.mjs
```

**这条是硬要求，不是可选动作：**

- `run.mjs` 跑完会**自动关闭**它启动的浏览器（除非加了 `--keep-browser`）。用 `--analyze-only` 或 `--dry` 时不会关，因为那两种情况它也没启动。
- 如果你**手动**起过浏览器（跑了 `launch.mjs`），用完必须自己关——用户明确要求过"打开的网页用完就关"，别留在桌面上。
- 关闭只按工具链 `profile` 路径匹配，绝不按进程名一把杀。
- 只关浏览器、不删 profile：profile 保留着登录态，下次开就能直接用，省一次扫码。

保留：`normalized.json`、`transcripts/`、报告 `.md`。

## 更多资料

- 踩过的坑、失败路径、环境坑、版本坑：[REFERENCES.md](REFERENCES.md)
- 报告写法与判断范例：[EXAMPLES.md](EXAMPLES.md)
