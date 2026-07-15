# KET 单词冲刺

给孩子使用的本地 `A2 Key for Schools` 单词学习网站。后端是原生 Node.js HTTP 服务，前端是单页应用，数据使用 SQLite 保存。

## 当前数据结构

- `data/wordbank.sqlite`：词库基线，随仓库提交，保存词条、中文解释、音标、本地音频索引和 SUBTLEX-UK 日常词频。
- `data/learning.sqlite`：学习记录库，不提交到仓库，保存进度和答题记录。服务启动时如果不存在会自动创建空库；线上部署时必须持久化保护。
- `data/auth-config.json`：本地生成的登录密码哈希和 session 密钥，不提交到仓库。
- `data/study-config.json`：学习配置，随仓库提交，集中控制每日目标、错题规则和进入默写的最低词频分数。
- `data/backups/`：自动每日备份目录，不提交到仓库。
- `public/audio/`、`public/assets/fonts/`、`public/fonts.css`：离线音频和字体资源，随仓库提交。

`wordbank.sqlite` 只保存词条数据，不保存认词、听词、默写等学习策略。
每个词的 `frequency_zipf`、`child_frequency_zipf`、`frequency_score` 和 `frequency_source` 都已固定写入该数据库；服务运行时只读取这些值，不会实时计算词频。学习顺序只使用综合后的 `frequency_score`。

旧的 `data/ketwords.sqlite` 已经废弃，不再参与运行。

## 功能

- 按认词、听词、拼写三种模式安排学习节奏。
- 首页显示考试倒计时、今日计划、打卡和进度。
- 家长看板显示累计进度、预计完成度和可按状态筛选的词汇掌握地图。
- 支持英式/美式变体、错题回炉和间隔复习；拼写错一个字母就按错误处理。
- 学习端和家长端有简单密码登录，避免接口裸露。
- 启动后按天自动备份学习库和词库快照。

## 运行要求

- Node.js 22 LTS 或更高版本。
- npm。
- 如果要重新生成离线缓存，机器需要能访问外网。

## 快速启动

```bash
npm ci --omit=dev
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
npm run import:frequency -- /path/to/SUBTLEX-UK.txt.zip
npm run cache:offline
npm test
```

- `npm run dev`：监听模式启动服务。
- `npm start`：普通启动。
- `npm run build:wordlist`：开发时根据本地 PDF 生成或刷新词表快照，需要先执行完整的 `npm ci`。
- `npm run import:frequency`：把 SUBTLEX-UK 英国英语词频写入 `data/wordbank.sqlite`；单词使用原始词频，短语使用组成词估算。
- `npm run cache:offline`：补齐中文释义、音标、音频和字体缓存，并写入 `data/wordbank.sqlite`。
- `npm test`：使用 Node.js 内置测试检查学习规则、旧记录迁移和词库资源完整性，不引入额外测试依赖。

正常启动只读取已提交的 `data/wordbank.sqlite`，不解析 PDF，也没有第三方运行依赖。词库缺失或为空时服务会直接报错，避免用不完整的备用词表继续运行。

## 登录配置

可用环境变量指定登录密码：

```bash
KET_STUDY_PASSWORD=孩子端密码
KET_ADMIN_PASSWORD=家长端密码
KET_SESSION_SECRET=一段足够长的随机字符串
```

如果没有设置，服务首次启动会自动生成 `data/auth-config.json`。

系统只使用一套数值词频：`frequency_score` 决定认词、听词和拼写顺序，不再使用 S/A/B/C 档位。考试日期、每日目标、加练节奏、错题等待时间和拼写分数线都集中保存在 `data/study-config.json`：

```json
{
  "examDate": "2026-08-22",
  "prepStartDate": "2026-04-22",
  "dailyTargets": {
    "recognize": 60,
    "listen": 20,
    "spell": 10
  },
  "afterTargetSequence": [
    "recognize", "recognize", "recognize", "recognize", "recognize", "recognize",
    "listen", "listen", "spell"
  ],
  "wrongParkDays": {
    "recognize": 3,
    "listen": 3,
    "spell": 7
  },
  "dailyWrongRetryLimits": {
    "recognize": 6,
    "listen": 4,
    "spell": 3
  },
  "repeatedWrongThreshold": 3,
  "spellFrequencyMinScore": 5.5
}
```

完成每日 `60/20/10` 后，系统按 `6 个认词、2 个听词、1 个拼写` 的节奏继续加练。当天认过的词不会在当天进入听词，当天认过或听过的词不会在当天进入拼写。

当前冲刺阶段会把未接触词排在到期复习词和错词之前，以便尽快完成全词库筛查。认词或听词答错后等待 3 天再出现，拼写答错后等待 7 天；每日重新进入队列的错词数量分别最多为 6、4、3 个。

家长掌握地图用底色表示词语当前所处阶段：未学习、认词中、听词中、拼写中或已掌握。累计错误达到 `repeatedWrongThreshold` 的词会额外显示红点，并可单独筛选；红点表示历史上反复出错，不会覆盖当前掌握阶段。

如果以后想扩大默写范围，只需要降低 `spellFrequencyMinScore`：

```json
{
  "spellFrequencyMinScore": 5.0
}
```

这不会清空已有学习进度。
所有词都会进入认词和听词；`spellFrequencyMinScore` 只控制哪些词有资格进入默写。默写只使用清洗后的单个英文词：包含空格、短划线、句点等符号的词组不会进入默写，括号里的词性、英美标记和可选补充也不会作为默写内容。

词表中的同形词如果代表不同词性或义项，会保留为独立学习条目，例如 `train` 的“火车”和“训练”。这类条目不是重复数据，孩子需要分别识别对应含义。旧版学习记录中的 `word_key` 会在启动时按当前词库自动规范化，之后只使用稳定的词条 key 关联进度。

## 版本管理建议

- 建议提交：源码、`package-lock.json`、`data/wordbank.sqlite`、`data/study-config.json`、`public/audio/`、`public/assets/fonts/`、`public/fonts.css`。
- 建议忽略：`node_modules/`、`tmp/`、`data/learning.sqlite*`、`data/wordbank.sqlite-shm`、`data/wordbank.sqlite-wal`、`data/auth-config.json`、`data/backups/`。
- `data/a2-key-vocabulary-list.pdf` 和 `tmp/official-materials/` 这类官方材料请先确认版权和分发范围。

## 部署

详细部署步骤见 [docs/deployment.md](./docs/deployment.md)。
