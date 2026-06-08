# KET 单词冲刺

给孩子使用的本地 `A2 Key for Schools` 单词学习网站。后端是原生 Node.js HTTP 服务，前端是单页应用，数据使用 SQLite 保存。

## 当前数据结构

- `data/wordbank.sqlite`：词库基线，随仓库提交，保存词条、中文解释、音标和本地音频索引。
- `data/learning.sqlite`：学习记录库，不提交到仓库，保存进度和答题记录。服务启动时如果不存在会自动创建空库；线上部署时必须持久化保护。
- `data/auth-config.json`：本地生成的登录密码哈希和 session 密钥，不提交到仓库。
- `data/study-config.json`：学习配置，随仓库提交，控制哪些优先级进入默写。
- `data/backups/`：自动每日备份目录，不提交到仓库。
- `public/audio/`、`public/assets/fonts/`、`public/fonts.css`：离线音频和字体资源，随仓库提交。

`wordbank.sqlite` 只保存词条数据，不保存认词、听词、默写等学习策略。

旧的 `data/ketwords.sqlite` 已经废弃，不再参与运行。

## 功能

- 按认词、听词、拼写三种模式安排学习节奏。
- 首页显示考试倒计时、今日计划、打卡和进度。
- 家长看板显示累计进度、错词、预计完成度和词条明细。
- 支持英式/美式变体、错题回炉和间隔复习；拼写错一个字母就按错误处理。
- 学习端和家长端有简单密码登录，避免接口裸露。
- 启动后按天自动备份学习库和词库快照。

## 运行要求

- Node.js 22 LTS 或更高版本。
- npm。
- 如果要重新生成离线缓存，机器需要能访问外网。

## 快速启动

```bash
npm ci
npm start
```

默认监听 `3210` 端口，也可以覆盖：

```bash
PORT=4321 npm start
```

启动后访问：

- [http://localhost:3210/](http://localhost:3210/)
- [http://localhost:3210/admin](http://localhost:3210/admin)

## 常用命令

```bash
npm run dev
npm start
npm run build:wordlist
npm run cache:offline
```

- `npm run dev`：监听模式启动服务。
- `npm start`：普通启动。
- `npm run build:wordlist`：根据本地词表文件生成或刷新词表快照。
- `npm run cache:offline`：补齐中文释义、音标、音频和字体缓存，并写入 `data/wordbank.sqlite`。

## 登录配置

可用环境变量指定登录密码：

```bash
KET_STUDY_PASSWORD=孩子端密码
KET_ADMIN_PASSWORD=家长端密码
KET_SESSION_SECRET=一段足够长的随机字符串
```

如果没有设置，服务首次启动会自动生成 `data/auth-config.json`。

默认默写等级配置保存在 `data/study-config.json`：

```json
{
  "spellPriorityLevels": ["S", "A", "B"]
}
```

如果暂时只想让 `S` 级词进入默写，可以改成：

```json
{
  "spellPriorityLevels": ["S"]
}
```

这不会清空已有学习进度。
所有词都会进入认词和听词；`spellPriorityLevels` 只控制哪些优先级进入默写。默写时空格、短划线、句点这类符号会直接显示，孩子只需要输入字母和数字。

## 版本管理建议

- 建议提交：源码、`package-lock.json`、`data/wordbank.sqlite`、`data/study-config.json`、`public/audio/`、`public/assets/fonts/`、`public/fonts.css`。
- 建议忽略：`node_modules/`、`tmp/`、`data/learning.sqlite*`、`data/wordbank.sqlite-shm`、`data/wordbank.sqlite-wal`、`data/auth-config.json`、`data/backups/`。
- `data/a2-key-vocabulary-list.pdf` 和 `tmp/official-materials/` 这类官方材料请先确认版权和分发范围。

## 部署

详细部署步骤见 [docs/deployment.md](./docs/deployment.md)。
