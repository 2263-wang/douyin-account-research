# 踩过的坑与失败路径

这份文档记录**已经验证过会失败的做法**。遇到问题时先读这里，别重走一遍。

---

## 一、访问层：三条路走过，只有一条通

| 做法 | 结果 | 为什么 |
|---|---|---|
| httpx / `Invoke-WebRequest` 直接请求 | HTTP 200，但返回**固定 72914 字节的空壳**，可见文本 0 字 | 字节跳动反爬壳：响应里是 `_$jsvmprt` 混淆脚本 + `__ac_nonce` cookie + `X-Agw-Info` 头，真内容要浏览器执行 JS 算出 `__ac_signature` 后再换 |
| headless Edge（`--headless=new --dump-dom`） | JS 能跑，DOM 有 8854 字节——但内容是**"验证码中间页"** | 服务端识别出无登录态 + 自动化客户端，把内容换成验证码 iframe |
| **可见窗口 + 用户人工登录**（本 skill 采用） | 通 | 真实会话 + 正常 UA |

**结论：不要试图修前两条。** 直接要求用户登录。

---

## 二、CDP 使用中的坑

### 2.1 监听器挂错 target，静默丢数据

**现象**：监听 12 分钟，只收到 12 个接口响应，而且全是空的弹幕接口。

**原因**：监听器连的是"搜索页"这一个 page target。用户在视频页**开新标签页**——那是另一个 target，完全看不见。**不报错，只是什么都收不到。**

**正确做法**：
- 枚举 `/json/list` 里所有 page target；
- 或者要求用户在**同一个标签页内**导航；
- 或者对每个新 target 重新挂一次监听。

排查方法：`(Invoke-WebRequest 'http://127.0.0.1:9222/json/list' -UseBasicParsing).Content` 看有几个 page。

### 2.2 连接浏览器级 endpoint 需要自定义 Host 头

`/json/version` 里的 `webSocketDebuggerUrl`（形如 `/devtools/browser/...`）需要 HTTP 握手时带 `Host: localhost`，Node 内置 `WebSocket` 不支持自定义头。

**绕过**：改用**页面级** target 的 `webSocketDebuggerUrl`（`/json/list` 里每个 page 都有），它不需要额外头。本 skill 的 `lib/cdp.mjs` 就是这么做的。

### 2.3 页面里的 fetch 必须同源

在 `Runtime.evaluate` 里执行 `fetch` 时，脚本运行在页面上下文。抖音的 page target 是 `www.douyin.com`，所以请求 `https://www.douyin.com/aweme/v1/...` 是同源，**签名和 cookie 自动带上**。这是本 skill 能取到详情接口的关键。

---

## 三、下载层的坑

### 3.1 yt-dlp 的抖音提取器是坏的

```python
# yt-dlp/extractor/tiktok.py  DouyinIE._real_extract
detail = traverse_obj(self._download_json(
    'https://www.douyin.com/aweme/v1/web/aweme/detail/', ...), ('aweme_detail', {dict}))
if not detail:
    # TODO: Run verification challenge code to generate signature cookies
    raise ExtractorError('Fresh cookies (not necessarily logged in) are needed', ...)
```

**它压根不生成签名**，所以详情接口永远拿不到，然后报"需要新鲜 cookie"误导人。

- `--cookies-from-browser chrome` → `Failed to decrypt with DPAPI`（Chrome 新版 App-Bound Encryption 把 cookie 绑到应用）
- 手动导出 cookie 给它 → **仍然报同一句错误**

**结论：不要修，也不要花时间。** 改用浏览器内 fetch（2.3）。

### 3.2 播放地址有有效期，裸 curl 必 403

搜索接口给的播放地址放置几小时后再用 → **403**。加 UA、加 Referer、加 Origin 全都 403——不是防盗链，是**过期**。

**正确做法**：每次下载前**重新**从详情接口取新鲜地址，取到立刻用（本 skill 的 `transcribe.mjs` 就是这个顺序）。

### 3.3 `bit_rate_audio` 在 web 端恒为空

详情 JSON 里有 `video.bit_rate_audio` 字段，但**始终是空数组**。

**正确做法**：web 端播放地址是**音视频合一的 mp4**，直接用最高码率的视频地址，用 ffmpeg `-vn` 抽音轨。

---

## 四、转写栈的坑

| 现象 | 原因 | 修法 |
|---|---|---|
| `TypeError: __init__(): incompatible constructor arguments ... compute_type=None` | ctranslate2 4.8.x 不接受 `compute_type=None` | 显式传 `int8`（cpu）/ `float16`（cuda） |
| `av.open() got an unexpected keyword argument 'metadata_errors'` | faster-whisper 1.2.1 与 PyAV 19.0.1 不兼容 | **不要降级别人的包**：用 `wave` 模块自己解 16bit PCM → numpy float32 → 直接喂 `model.transcribe(np_array)`，绕开 PyAV |
| 输出繁体 | whisper 默认行为 | `initial_prompt='以下是普通话的句子，请使用简体中文转写。'` + opencc `t2s` 兜底 |
| 中后段听错（专有名词） | `small` 模型能力有限 | 换 `medium`：更准，但下载 1.5G 模型、转写慢 3–4 倍 |

**性能实测**：CPU int8，`small` 模型，691 秒音频 → 267 秒完成（2.6 倍速）。

### 转写链路的自检方法（怀疑转写有问题时跑这个）

不用下载任何素材，用 Windows 自带语音合成造一段中文，看能不能转回来：

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Huihui Desktop')          # 中文语音
$s.SetOutputToWaveFile("$env:TEMP\tts-test.wav")
$s.Speak('大家好，今天我们来聊一聊人工智能工具怎么选，我踩过三个坑。')
$s.Dispose()

ffmpeg -hide_banner -loglevel error -y -i "$env:TEMP\tts-test.wav" -vn -ac 1 -ar 16000 -c:a pcm_s16le "$env:TEMP\tts-16k.wav"
python scripts/transcribe.py "$env:TEMP\tts-16k.wav" --model small --device cpu --outdir "$env:TEMP\tts-out"
```

**已验证结果**（2026-10）：输出与输入逐字一致，2.2 倍速。

**注意**：不要用纯正弦波测试音频——它会被人声检测（VAD）过滤掉，输出 0 字，让你误以为转写坏了。

---

## 五、Windows 环境坑

1. **PS 5.1 按 GBK 读 UTF-8 脚本** → 中文字符串被截断，报"字符串缺少终止符"。
   ```powershell
   $enc = New-Object System.Text.UTF8Encoding($true)   # $true = 带 BOM
   [System.IO.File]::WriteAllText($path, $txt, $enc)
   ```
   或把 `.ps1` 写成纯 ASCII，中文交给 Node/Python 输出。

2. **脚本 stdout 经过 PS 管道会变乱码**：Python 打印的 UTF-8 被按 GBK 读，写进文件变成 `�����`。
   **正确做法：要生成中文文件，让 Python/Node 自己 `writeFileSync / write_text(encoding='utf-8')`，不要 print 出来再重定向。**

3. **PS 5.1 不支持 `?.` 和三元运算符 `? :`**：
   ```powershell
   $obj?.a          # 报错
   $x ? 'a' : 'b'   # 报错
   ```
   用 `if` 或直接交给 Node 处理。

4. **`.NET` 静态方法不认 PowerShell 的当前目录**：`Set-Location` 之后用相对路径调 `[System.IO.File]::ReadAllBytes()` 会失败。**一律用绝对路径。**

5. **本机只有 Windows PowerShell 5.1，没有 `pwsh`**。脚本里不要调 `pwsh`。

6. **curl 的 `-w` 输出在 PS 里会混进 stderr**，`$LASTEXITCODE` 判断更可靠。

---

## 六、适配工具链输出时的坑（已实测）
## 七、跨平台改造踩到的坑

原本这套东西是 Windows-only 的。改成三平台通用时踩到：

| 现象 | 根因 | 修法 |
|---|---|---|
| **`require` 在 ESM 里不能用** | `crawl.js` 用 `import` 语法（ESM），我在 Linux 分支里写了 `require('node:child_process')` | 改成顶层 `import { execFileSync }`。**改工具链脚本前先看头部是 import 还是 require** |
| `login.js` 报 `execFileSync is not defined` | 它只导入了 `spawn, spawnSync`，没有 `execFileSync` | 用已导入的 `spawnSync('which', ...)` |
| 打包后跑不起来，报 `SKILL is not defined` | `run.mjs` 的 `findToolkit()` 引用了未定义变量；**开发机有 `dsh-browser` 兜底目录，永远跑不出这个 bug** | 定义 `SKILL` 常量，并把定位逻辑抽到 `lib/toolkit.mjs` |
| 差点把浏览器登录态打进包 | 按**扩展名**过滤，`profile/ZxcvbnData/passwords.txt`、`WasmTtsEngine/*.js` 全被打进去了 | 必须**目录级剪枝**（`profile/`、`search-results/`、`node_modules/`、`__pycache__/`） |
| `.ps1` 中文乱码 + 解析错误 | PS 5.1 按 GBK 读无 BOM 的 .ps1 | 构建脚本自动给所有 `.ps1` 补 UTF-8 BOM |
| `install.sh` / `launch.sh` 没进包 | `TOOLKIT_EXT` 白名单里没有 `.sh` | 加上 `.sh` |

**跨平台要点**：

- 浏览器定位按平台分支：Windows `Program Files`/`LOCALAPPDATA`；macOS `/Applications/*.app/Contents/MacOS/*`；Linux `which`
- 关进程也要分支：Windows 用 CIM + `taskkill`；macOS/Linux 用 `ps -ax -o pid=,command=` + `SIGTERM`
- **匹配要够严**：只按 `--user-data-dir` 完整路径 + 工具链目录名双重命中，否则会误杀用户自己的浏览器
- 不认的路径留给 `DSH_BROWSER` 环境变量覆盖


工具链各脚本的输出字段不统一，且有些字段名会误导人。`lib/adapt.mjs` 已经处理好，改它之前先看这里：

| 文件 | 坑 | 正确取法 |
|---|---|---|
| `works-*.json` | **`desc` 是空的**，真正文案在 `raw` 里 | `raw` 形如 `"295 3个Skill，把书…"`，开头的数字是点赞数，要剥掉（`parseRawCard`） |
| `vstats-*.json` | 同上；`play` 常为 `null` | 用 `raw` 里的文案 + `digg`/`comment` 字段 |
| `dates-*.json` | 日期字段是 **`abs`**，不是 `published` | `publishedAt: r.abs` |
| `*-classified.json` | 数据在 `scored` 数组里，不是 `results` | 两个都要兜 |
| `comments-*.json` | `text` 是**整块 innerText**：`"昵称 ... 正文 1月前·广东 99 分享 回复"`；`like` 常为 `null` | 用 `parseComment()` 拆正文/时间/地区/点赞 |
| `batch-works.json` / `batch-ai.json` | 结构是 `results[].profile + results[].items`，和 `works.json` 不同 | 单独一种形状 `batchWorks` |
| `works-*.json` 的 `dur` | **常有 `null`**，所以时长中位数会算不出来 | 报告里如实显示 `—`，不要编 |

**校验方法**：适配完先看 `normalize.mjs` 打印的"形状分布"，`unknown` 不为 0 就说明有新形状没认出来。

**另一个容易踩的**：工具链目录里堆着历史产物，如果把它们全喂给分析，会把旧数据算进本次结果。`run.mjs` 按模式用白名单（`TOOLKIT_GLOBS`）取数，别改成扫全目录。

---

## 八、真跑踩到的坑（2026-10 实测）

这些是拿真实账号跑完整链路时暴露的，比读代码能发现的更值钱：

| 现象 | 根因 | 修法 |
|---|---|---|
| `works.js` 静默返回 **0 条作品**，profile 全 null | 把**昵称**当 secUid 传进去了。`works.js` / `dates.js` 只认 secUid，不报错、直接空 | `run.mjs` 现在会先判断参数形态：secUid / 主页URL 直接用，昵称则调 `resolve-account.mjs` 搜"用户"tab 解析 |
| `dates.js` 报 `Cannot navigate to invalid URL` | 同上，昵称拼进了 `/user/<昵称>` | 同上 |
| 报告里混进了**别的账号**的视频 | `run.mjs` 默认把工具链目录里的历史产物全喂给分析，旧数据算进了本次结果 | 默认**不吃历史产物**；要吃得显式加 `--with-history` |
| 一跑就是 109 条全部作品，太慢也没必要 | 没有时间窗 | 加 `--days N`（默认 30）/ `--since <日期>`；`vstats`/`comments` 只跑窗口内作品 |
| 浏览器开着一整天不关 | 我漏了收尾 | `run.mjs` 跑完**自动关**（`finally` 里按 `dsh-browser\profile` 过滤关闭）；手动起过就手动关 |

**校验口诀**：采集步骤跑完先看 `works.json` 的 `count`。**如果是 0，后面全是白跑**，别急着出报告。

### 已知未修：回复线程被拼成一条

`comments.js` 读的是 `[data-e2e="comment-item"]` 的整块 innerText，**展开的回复会被并进同一条**，于是出现这种"一条评论里塞了 4 个人"的：

```
黄圈圈转起来了 25分钟前·广东 0 分享 回复 飞鸟与鱼～～ ... 真是太厉害了 1分钟前·河南 ... 一切向阳 ... 我的也转圈圈了 18分钟前·广东
```

影响：点进去看是完整的，但**排出来的句子读着怪**，而且会把"我的也转圈圈了"这种短信号淹掉。

修法（未做）：在 `parseComment()` 里检测 `昵称 ... ` 模式，把长文本按"昵称 + 时间·地区"切回多条。判据：文本里出现 ≥2 次 `\d+[分时天]前·[省市]` 就说明是拼接的。

---

## 九、数据本身的局限（报告里必须写明）

| 想要的数据 | 接口是否返回 | 说明 |
|---|---|---|
| 播放量 | ❌ | 搜索/详情接口都不返回 |
| 完播率 | ❌ | 只有创作者后台有 |
| 点赞/评论/收藏/分享 | ✅ | `statistics` |
| 视频时长 | ✅ | `video.duration`（毫秒） |
| 粉丝数 | ⚠️ | 搜索接口常返回空；详情接口的 `author.follower_count` 更可靠 |
| 评论 | ✅ | `/comment/list/`，需滚动触发分页 |
| 自动字幕 | ⚠️ | `video.cla_info.caption_infos`，web 端多数为空——所以本 skill 走音频转写 |

**不要在报告里给"完播率"或"播放量"的结论。**

---

## 十、风控观察（实测）

- 连续点开多个视频页后，target 列表里会出现 `rmc-nocaptcha` 验证组件的 iframe。
- **它出现 ≠ 用户被拦住**：该组件常是预加载。判断是否真的触发，要看**用户是否被打断**（功能性证据优先于结构性证据）。
- 即便如此，**放慢节奏**（一次一个视频、间隔十几秒）是成本最低的保险。
- 若用户真的被要求验证：**让用户自己完成**，不要尝试自动化。

## 十一、清理清单

```powershell
# 只关自己起的浏览器：按配置目录过滤，别按进程名一把杀
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -match 'dy-cdp-profile' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Remove-Item "$env:TEMP\dy-cdp-profile" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item data/audio -Recurse -Force -ErrorAction SilentlyContinue   # 中间产物
Remove-Item data/raw   -Recurse -Force -ErrorAction SilentlyContinue   # 原始抓包
```

## 十二、数据卫生（换机器时最容易翻车的地方）

**症状**：在另一台电脑上跑，结果里出现了**上一台电脑分析过的账号**。

**根因（三处，都实际发生过）**：

1. **代码里留了硬编码的"历史数据兜底"**
   `applyWindow()` 曾写成：优先读本次的 `dates.json`，读不到就退回读
   `TOOLKIT/dates-qiuzhi2046-classified.json`。
   → 换机器后如果那个文件存在，就会把**别的账号的日期**灌进本次结果，而且**不报错**。
   **修法**：只认本次运行产出的文件。查不到就走别的兜底（如从作品 id 时间戳推算），绝不去翻别的文件。

2. **示例数据用的是真实采集产物**
   一开始把 `works-<真实账号>.json` 复制进 `examples/`——等于把某个真实账号的数据发了出去。
   **修法**：示例必须**合成**（`package-build/gen-examples.mjs` 生成虚构账号），且文件名里带 `demo`。

3. **工具链目录里堆着历史产物**
   `clicksearch-*.json`、`works-*.json`、`search-merged.json` 全是历次跑出来的真实数据。
   一旦被扫进分析，旧账号就"复活"了。
   **修法**：默认不吃；要吃得显式 `--with-history`，并且**打包时整体排除**。

**自查命令**（出包前必跑）：

```bash
# 顺着"人名/账号名"查一遍，看有没有不该出现的引用
grep -rn '<账号名>' .          # macOS/Linux
findstr /s /i /c:"<账号名>" *  # Windows
```

**三条铁律**：

- 分析引擎**只吃本次运行目录**里的文件，不吃任何"上一轮的产物"
- 分发包里的 `examples/` **只能是合成数据**，文件名带 `demo`
- 打包时**目录级排除**所有数据目录（`profile/`、`search-results/`，以及工具链根目录的 `*.json`）

## 十三、浏览器生命周期：谁负责收尾

**症状**：跑完一次分析，桌面上留着一个 Chrome 窗口，用户得自己关。

**根因**：生命周期没人负责。`run.mjs` 里有 `finally { closeBrowser() }`，但 `launch.mjs`、`fetch-detail.mjs`、`resolve-share.mjs` 都是独立脚本，各自跑完就退出，浏览器留在那。用「先 launch → 再 fetch-detail → 再 transcribe」这种方式干活时，窗口就一直挂着。

**修法**：新增 `lib/browser-lifecycle.mjs`，把这套行为统一起来。

| 脚本 | 浏览器不在跑时 | 跑完 |
|---|---|---|
| `run.mjs` | 用现有的 | 自动关 |
| `fetch-detail.mjs` / `resolve-share.mjs` | **自动起**（`spawnLauncher`） | **自动关**（`registerCleanup`） |
| `launch.mjs` | 它就是启动器 | 不关（等用户扫码） |
| `transcribe.mjs` | 不需要浏览器（ffmpeg 拉流 + 本地转写） | — |

`registerCleanup()` 挂 `exit` / `SIGINT` / `SIGTERM` 三个钩子；`--keep-browser` 可跳过。

**踩到的第二个坑**：加了"自动起浏览器"之后，紧接着取详情会报 **`Failed to fetch`**——端口通了，但页面还停在 `about:blank`，在那种页面里同源 fetch 必然失败。

**修法**：`ensureBrowser()` 起完浏览器后调用 `waitForDouyinPage()`，轮询 `/json/list` 直到出现 `douyin.com` 的 page target，再额外等 2.5 秒让会话/签名就绪。

**判断口诀**：**只要一个脚本用了浏览器，它就得负责收尾。** 别指望用户记得关。
