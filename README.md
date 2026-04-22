# KET 单词冲刺

给单个孩子使用的本地 `A2 Key for Schools` 单词学习网站。后端是原生 Node.js HTTP 服务，前端是单页应用，学习进度保存在本地 SQLite。

当前仓库已经带了一份可直接部署的离线基线资源，包括：

- `data/ketwords.sqlite` 中的词条元数据、中文解释、已有音标和本地音频索引
- `public/audio/` 中的本地发音缓存
- `public/assets/fonts/` 和 `public/fonts.css` 中的离线字体资源

## 当前功能

- 基于 `A2 Key for Schools` 词表生成学习库
- 按认词、听词、拼写三种模式自动安排学习节奏
- 首页展示考试倒计时、今日学习计划和打卡情况
- 家长看板展示累计进度、错词、预计完成度和词条明细
- 支持家长手动补充陌生词，并优先加入学习队列
- 支持 typo 容错、英式 / 美式变体、错题回炉和间隔复习
- 可选离线缓存中文释义、音标、音频和字体，减少对外网的依赖

## 页面与路由

- `/`：孩子端首页 + 学习页
- `/admin`：家长看板
- `/api/overview`：总览数据
- `/api/study/next`：下一张学习卡片
- `/api/study/answer`：提交答案
- `/api/parent/words`：查询 / 新增家长补词
- `/api/health`：健康检查

说明：

- `/admin` 不是单独的 HTML 文件，而是同一个前端入口根据路径切换到家长模式
- 目前代码里没有登录鉴权；如果要部署到公网，至少要在反向代理层做访问限制

## 运行环境

- 建议 Node.js 22 LTS 或更高
  说明：代码使用了 `node:sqlite`、原生 `fetch` 和 `AbortSignal.timeout`
- npm
- 如果要首次生成离线缓存，部署机器需要能访问外网

## 快速启动

```bash
npm ci
npm start
```

默认监听 `3210` 端口，也可以通过环境变量覆盖：

```bash
PORT=4321 npm start
```

启动后访问：

- [http://localhost:3210/](http://localhost:3210/)
- [http://localhost:3210/admin](http://localhost:3210/admin)

## 首次初始化建议

仓库当前已经提交了一份可直接运行的离线基线资源，首次部署通常不需要先跑缓存脚本。  
如果你想重新拉取或补齐最新的中文释义、音标、本地音频和字体缓存，再执行：

```bash
npm run cache:offline
```

这一步会：

- 下载并缓存字体到 `public/assets/fonts/`
- 生成 `public/fonts.css`
- 为词库补充中文释义、音标和本地音频缓存
- 把对应元数据写入 `data/ketwords.sqlite`

如果不执行这一步，服务仍然可以启动，但首次部署出来的体验会更“轻量”：

- 词库依然可用
- 部分中文释义、音标和音频可能为空
- 音频缺失时会退回浏览器朗读

## 数据文件说明

- `data/a2-key-wordlist.json`
  已提交到仓库的词表快照。启动时优先使用它，不依赖 PDF。
- `data/a2-key-vocabulary-list.pdf`
  可选的原始词表 PDF，仅在你想重新解析并生成词表快照时才需要。
- `data/ketwords.sqlite`
  已提交的部署基线数据库。启动后它也会继续保存词条元数据、学习进度、答题记录和家长补词结果。
- `data/study-config.json`
  本地学习配置。默认只有 `S` 级进入默写训练。
- `public/audio/`
  已提交的本地音频缓存目录。
- `public/assets/fonts/` 和 `public/fonts.css`
  已提交的离线字体缓存。

## 常用命令

```bash
npm run dev
npm run start
npm run build:wordlist
npm run cache:offline
```

- `npm run dev`：监听模式启动服务
- `npm start`：普通启动
- `npm run build:wordlist`：根据本地词表文件生成 / 刷新 `data/a2-key-wordlist.json`
- `npm run cache:offline`：补齐离线资源缓存

## 配置说明

默认默写等级配置保存在 `data/study-config.json`：

```json
{
  "spellPriorityLevels": ["S"]
}
```

如果想让 `A` 级词也进入默写，可以改成：

```json
{
  "spellPriorityLevels": ["S", "A"]
}
```

这不会清空已有学习进度。

## 部署

详细部署步骤见 [docs/deployment.md](./docs/deployment.md)。

## 版本管理建议

- 建议提交源码、`package-lock.json`、`data/a2-key-wordlist.json`、`data/ketwords.sqlite`、`public/audio/`、`public/assets/fonts/`、`public/fonts.css`
- 建议忽略 `node_modules/`、`tmp/`、`data/ketwords.sqlite-shm`、`data/ketwords.sqlite-wal`、`data/study-config.json`
- 如果后续要推到远端仓库，`data/a2-key-vocabulary-list.pdf` 和 `tmp/official-materials/` 这类官方材料请先确认版权和分发范围
