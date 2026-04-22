# KET 单词冲刺

给单个孩子使用的本地 `A2 Key for Schools` 单词学习网站。

## 功能

- 依据 Cambridge 官方词表初始化单词库
- 单词分成识别、听辨、拼写三类学习目标
- 首页显示考试倒计时和今天的动态学习任务
- 家长看板显示学习分钟数、掌握进度和距离目标的差距
- 家长看板支持手动补充备考中遇到的陌生词，并优先加入学习队列
- 错词自动回到复习队列，按间隔重复出现
- 拼写支持提交后判定，并接受一定 typo 容错和英式 / 美式变体

## 启动

```bash
npm install
npm run cache:offline
npm start
```

然后打开：

[http://localhost:3210](http://localhost:3210)

家长看板入口：

[http://localhost:3210/admin](http://localhost:3210/admin)

## 说明

- 运行 `npm run cache:offline` 会把字体、中文释义、音标和在线发音批量缓存到本地
- 首次启动会解析本地官方 PDF 词表并写入 `data/a2-key-wordlist.json`
- 学习数据保存在 `data/ketwords.sqlite`
- 发音优先使用本地缓存音频，拿不到时会退回浏览器朗读
- 孩子端不显示家长看板入口，家长端单独走 `/admin`
- 在线资源缓存后，页面字体和已缓存单词资源都不再依赖外网
- 默写等级配置保存在 `data/study-config.json`，默认只有 `S` 级进入默写；后期如果想把 `A` 也加入，把 `spellPriorityLevels` 改成 `["S", "A"]` 即可，已保存的学习进度不会丢失

## 版本管理建议

- 建议提交源码、`package-lock.json` 和 `data/a2-key-wordlist.json`
- 建议忽略 `node_modules/`、`tmp/`、`data/*.sqlite*`、`data/study-config.json`、`public/audio/`、`public/assets/fonts/`、`public/fonts.css`
- 如果后续要推到远端仓库，`data/a2-key-vocabulary-list.pdf` 和 `tmp/official-materials/` 这类官方材料请先确认版权和分发范围
