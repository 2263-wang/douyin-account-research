# 抖音账号与选题调研 Skill

`douyin-account-research`：给一个选题、对标账号或一批视频，整理数据、分析内容结构，并从评论区挖掘可以拍摄的选题。

本仓库只存放这一项 Skill。动画制作 Skill 独立保存在 [animation-skill](https://github.com/2263-wang/animation-skill)，两个仓库分别安装、更新，互不依赖。本项目也不包含 `simple-account-operations`（简易账号运营）。

## 主要能力

| 模式 | 输入 | 主要产出 |
| --- | --- | --- |
| 选题调研 | 选题关键词 | 同类内容数据、时长与内容形式分析、机会方向 |
| 对标账号分析 | 账号昵称或主页链接 | 内容类型与表现、发布节奏、标题结构、可借鉴的方法 |
| 评论区选题挖掘 | 对标视频及评论 | 具体问题、需求与争议、可直接拍摄的选题 |
| 逐字稿分析（可选） | 目标视频 | 音频转写、开场与内容结构拆解 |

工作方法：采集样本 → 统一数据 → 比较内容类型与互动表现 → 按信息价值筛选评论 → 给出可执行建议。详情见 [SKILL.md](skills/douyin-account-research/SKILL.md) 和 [报告写法范例](skills/douyin-account-research/EXAMPLES.md)。

## 安装到 Codex

把这句话发给 Codex：

> 请将 https://github.com/2263-wang/douyin-account-research 仓库里的 skills/douyin-account-research 安装到我的 Codex 技能目录。保留完整的 scripts、toolkit、examples 和配套文档，检查环境并运行离线示例。

也可以将 `skills/douyin-account-research` 整个文件夹复制到个人技能目录。Codex 通常为 `~/.codex/skills/`，自定义 `CODEX_HOME` 时使用其下的 `skills/`。WorkBuddy 可放在 `~/.workbuddy/skills/`，DSH 可放在 `~/.dsh/skills/`。

只复制这一整个 Skill 文件夹，不要把它与其他 Skill 的文件合并；更新旧版本前先备份本机配置。

## 快速验证与使用

进入 `skills/douyin-account-research` 后执行：

```bash
# 环境检查
node scripts/verify-env.mjs

# 离线示例：不需要登录抖音，也不会打开浏览器
node scripts/run.mjs --analyze-only --mode account --outdir ./demo-out --inputs ./examples

# 在线调研：启动浏览器后，由用户在窗口中扫码登录
node scripts/launch.mjs

# 按账号调研
node scripts/run.mjs --mode account --account "账号昵称或主页链接"

# 按关键词调研
node scripts/run.mjs --mode topic --keyword "月嫂培训"
```

也可以在安装后直接提出需求：

- `用 $douyin-account-research 分析这个对标账号：<主页链接>。`
- `用 $douyin-account-research 调研“月嫂培训”的选题机会。`
- `分析这些视频的评论区，找出有具体问题和场景的选题。`

## 文件入口

- [SKILL.md](skills/douyin-account-research/SKILL.md)：完整流程与判断方法。
- [使用说明](skills/douyin-account-research/使用说明.md)：环境、三种模式和数据范围。
- [安装与发布说明](skills/douyin-account-research/PUBLISHING.md)：来源、版本核对、推荐入口与已知限制。
- [报告范例](skills/douyin-account-research/EXAMPLES.md)：从数字和评论写出判断。
- [已知问题](skills/douyin-account-research/REFERENCES.md)：历史排查记录与适配问题。
- `scripts/`、`toolkit/`、`examples/` 均位于 Skill 目录内，分别提供分析脚本、浏览器采集工具和合成示例。

## 数据与来源

本仓库整理自「DSH-抖音账号运营Skill-20261106.zip」对应的本地分发版本，原始 Skill 文件按清单保留，未混入其他 Skill。原包的文件来源见 [打包说明](skills/douyin-account-research/打包说明.txt) 和 [MANIFEST.json](skills/douyin-account-research/MANIFEST.json)。

本工具无法取得的播放量、完播率不得编造；报告应注明样本量、采集时间与局限。合成示例用于验证分析流程，不能代表真实账号表现。在线采集需要登录，且会受抖音页面变动影响。

仓库不包含浏览器登录态、Cookie 或历史采集数据。第三方代码与材料遵循其原有许可及来源说明；本次整理不额外授予许可。
