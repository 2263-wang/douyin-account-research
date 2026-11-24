# 安装与发布说明

本仓库只发布 `douyin-account-research`，正式名称为「抖音账号与选题调研」。原始分发包名为「DSH-抖音账号运营Skill」。

## 安装与版本

- 完整复制本目录到目标工具的个人 `skills/` 目录，保留 `scripts/`、`toolkit/`、`examples/` 和文档。
- 原包的 `install.ps1`、`install.sh` 固定安装到用户主目录的 `.codex/skills/`。使用 WorkBuddy、DSH 或自定义 `CODEX_HOME` 时，请直接复制完整目录。
- 更新旧版本前，先备份原目录和本机配置。此 Skill 与动画制作 Skill 分仓保存，更新其中一个不会更新另一个。

## 推荐入口与已知限制

使用 `scripts/verify-env.mjs` 检查环境，使用 `scripts/run.mjs` 执行三种调研模式。离线验证命令：

```bash
node scripts/run.mjs --analyze-only --mode account --outdir ./demo-out --inputs ./examples
```

`examples/` 包含合成数据。离线流程通过不代表当前抖音页面的线上采集已经通过验证。

原包代码保持原样。旧版辅助脚本 `toolkit/search-batch.ps1` 仍含原开发机绝对路径，跨机器使用时采用上述 `scripts/` 入口。浏览器链路用到全局 `WebSocket`，在线使用前应核对本机 Node 是否具备该能力，不能只依赖旧文档里的最低版本数字。

## 来源与完整性

- GitHub 整理日期：2026-11-24（北京时间）。
- 来源：本地安装的 `douyin-account-research`，对应 2026-11-06 分发包。
- 原包 67 个文件完整保留；65 个文件的 SHA-256 与原始 `MANIFEST.json` 一致，另外两个文件是清单自身和 `打包说明.txt`。
- 本次新增的 `PUBLISHING.md` 与 `.gitignore` 属于发布配套文件，不在原包清单内。
- 仓库使用 `.gitattributes` 保留 Skill 文件的原始字节，避免 Git 换行符转换使清单校验失效。
- 原始来源与打包经过见[打包说明](打包说明.txt)。第三方材料沿用原有来源与许可，本次整理不额外授予许可。

仅发布技能文档、代码、浏览器工具链和合成示例。浏览器 profile、Cookie、登录态及历史任务均不在分发清单中；常见运行目录已加入 `.gitignore`。

## 本次发布验证

- Windows / Node.js v24.21.0：45 个 JavaScript 文件通过语法检查。
- 65 个原包文件通过 SHA-256 核对，仓库入口与 Skill 入口的本地链接检查通过。
- 账号模式离线示例成功读取 24 条合成视频、生成标准化数据与 182 行分析报告。
- 示例不包含评论，因此本次没有验证评论采集或真实账号在线采集。
