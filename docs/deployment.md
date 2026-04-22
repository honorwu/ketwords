# 部署文档

这份文档按当前代码整理，目标是让这个项目在一台普通 Linux 机器上稳定跑起来，并且后续便于更新、备份和迁移。

## 1. 部署前先确认

### 运行要求

- 建议 Node.js 22 LTS 或更高
- 需要 npm
- 建议使用 Linux + `systemd` 管理进程
- 如果首次要生成完整离线缓存，部署机器需要能访问外网

### 代码当前特性

- 服务端是原生 Node.js HTTP 服务，没有使用 Express
- 默认端口是 `3210`，可通过 `PORT` 环境变量覆盖
- 前端静态资源由同一个 Node 服务直接提供
- `/admin` 没有登录鉴权
- 当前仓库已经提交了一份离线基线资源，可直接用于首发部署

部署建议：

- 只在家庭内网、校园内网或受控网络中直接使用
- 如果必须暴露到公网，请在 Nginx / Caddy / Traefik 层加 Basic Auth、IP 白名单或其他认证

## 2. 目录与持久化文件

部署时最需要关注的是下面这些文件：

- `data/a2-key-wordlist.json`
  词表快照，已提交到仓库，启动时优先使用
- `data/ketwords.sqlite`
  已提交的主数据库基线。部署后它会继续写入学习记录和词条元数据
- `data/study-config.json`
  本地学习配置
- `public/audio/`
  已提交的本地音频缓存
- `public/assets/fonts/`
  已提交的本地字体缓存
- `public/fonts.css`
  已提交的离线字体样式文件

如果是从当前仓库直接部署，上述离线基线资源默认已经存在；只要 `npm ci` 后启动即可使用。

## 3. 快速部署

假设部署目录为 `/srv/ketwords`。

### 3.1 拉取代码

```bash
mkdir -p /srv
cd /srv
git clone <你的仓库地址> ketwords
cd /srv/ketwords
```

### 3.2 安装依赖

```bash
npm ci
```

### 3.3 按需刷新离线缓存

通常首发部署可以直接跳过。  
如果你想重新抓取或补齐缓存，再执行：

```bash
npm run cache:offline
```

这一步会把字体、音标、中文释义和音频尽量补齐，并更新本地数据库与静态资源。

### 3.4 启动服务

```bash
PORT=3210 npm start
```

看到类似下面的日志说明启动成功：

```text
KET words server running at http://localhost:3210
```

### 3.5 健康检查

```bash
curl http://127.0.0.1:3210/api/health
```

预期返回：

```json
{"ok":true}
```

## 4. 推荐上线方式：systemd + Nginx

### 4.1 创建 systemd 服务

新建 `/etc/systemd/system/ketwords.service`：

```ini
[Unit]
Description=KET Words
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/ketwords
Environment=PORT=3210
ExecStart=/usr/bin/env npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ketwords
sudo systemctl status ketwords
```

常用命令：

```bash
sudo systemctl restart ketwords
sudo systemctl stop ketwords
sudo journalctl -u ketwords -f
```

### 4.2 Nginx 反向代理

新建站点配置，例如 `/etc/nginx/conf.d/ketwords.conf`：

```nginx
server {
    listen 80;
    server_name ketwords.example.com;

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如果要限制家长看板或整站访问，建议在 Nginx 层加认证，而不是直接暴露：

- Basic Auth
- 仅允许内网 IP
- 仅通过 VPN 访问

## 5. 离线部署 / 受限网络部署

如果目标机器不能访问 Google、词典接口或在线发音源，建议先在一台能联网的机器上“预热”资源，再整体拷过去。

### 5.1 在联网机器上执行

```bash
npm ci
npm run cache:offline
```

### 5.2 复制这些文件到目标机器

- `data/ketwords.sqlite`
- `data/study-config.json`
- `public/audio/`
- `public/assets/fonts/`
- `public/fonts.css`

如果你直接使用当前仓库里的已提交离线资源，这一步通常不需要额外做；这里更适合“你重新刷新过缓存，想把新缓存整体搬到另一台机器”的场景。

## 6. 更新流程

建议每次更新都按下面顺序做：

### 6.1 备份数据

先停服务：

```bash
sudo systemctl stop ketwords
```

备份关键文件：

```bash
cp data/ketwords.sqlite data/ketwords.sqlite.bak
cp data/study-config.json data/study-config.json.bak 2>/dev/null || true
```

如果你很在意离线缓存，也可以一起备份：

```bash
tar -czf ketwords-offline-cache.tgz public/audio public/assets/fonts public/fonts.css
```

### 6.2 更新代码与依赖

```bash
git pull
npm ci
```

### 6.3 按需刷新缓存

以下情况建议重新执行一次：

- 词表有变化
- 需要补充更多音频 / 释义 / 音标
- 新服务器需要本地离线资源

命令：

```bash
npm run cache:offline
```

### 6.4 启动服务

```bash
sudo systemctl start ketwords
sudo systemctl status ketwords
```

## 7. 备份与恢复

### 7.1 最小备份集

至少备份：

- `data/ketwords.sqlite`
- `data/study-config.json`

### 7.2 完整备份集

如果希望恢复后保持完全一致的离线体验，再加上：

- `public/audio/`
- `public/assets/fonts/`
- `public/fonts.css`

### 7.3 恢复步骤

1. 停服务
2. 把备份文件覆盖回原位置
3. 启动服务
4. 访问 `/api/health` 验证

## 8. 常见问题

### 启动时报 `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`

Node 版本太低。升级到支持 `node:sqlite` 的版本，建议直接使用 Node.js 22 LTS 或更高。

### 页面能打开，但中文释义 / 音标 / 音频很多是空的

这是典型的“新部署但还没预热缓存”场景。执行：

```bash
npm run cache:offline
```

### `/admin` 可以被任何人访问

当前代码没有登录鉴权。不要直接裸露到公网；请在反向代理层加认证或至少做 IP 限制。

### 重启后学习进度丢了

通常是 `data/ketwords.sqlite` 没有持久化、被覆盖，或者部署脚本误删了数据库文件。

### 更新后端口不通

优先检查：

- `systemctl status ketwords`
- `journalctl -u ketwords -f`
- `curl http://127.0.0.1:3210/api/health`
- Nginx 配置和防火墙规则

## 9. 部署后的核对清单

- 服务已经启动：`systemctl status ketwords`
- 健康检查正常：`/api/health`
- 首页可访问：`/`
- 家长看板可访问：`/admin`
- 数据目录可写：`data/`
- 学习记录能落库：`data/ketwords.sqlite`
- 如需完整离线体验，离线缓存已经生成
