# 部署文档

这份项目目前使用两个 SQLite 数据库：

- `data/wordbank.sqlite`：词库，只保存可随代码发布的基线数据。
- `data/learning.sqlite`：学习记录，不提交仓库，必须在生产环境持久化和备份。

旧的 `data/ketwords.sqlite` 已废弃，不再需要部署或备份。

## 运行要求

- Node.js 22 LTS 或更高版本。
- npm。
- 推荐 Linux + systemd 管理进程。
- 如果要运行 `npm run cache:offline` 刷新离线资源，部署机需要能访问外网。

## 首次部署

```bash
mkdir -p /srv
cd /srv
git clone <你的仓库地址> ketwords
cd /srv/ketwords
npm ci
PORT=3210 npm start
```

启动后访问：

```text
http://localhost:3210/
http://localhost:3210/admin
```

健康检查：

```bash
curl http://127.0.0.1:3210/api/health
```

## 持久化文件

生产环境必须保留：

- `data/learning.sqlite`
- `data/learning.sqlite-wal`
- `data/learning.sqlite-shm`
- `data/auth-config.json`，如果没有使用环境变量配置密码和 session 密钥
- `data/study-config.json`，随代码部署，控制进入默写的最低词频分数
- `data/backups/`

`data/learning.sqlite` 如果首次不存在，服务会自动创建空库；已有线上库不会被覆盖。

## systemd 示例

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
Environment=KET_STUDY_PASSWORD=请替换为孩子端密码
Environment=KET_ADMIN_PASSWORD=请替换为家长端密码
Environment=KET_SESSION_SECRET=请替换为足够长的随机字符串
ExecStart=/usr/bin/env npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用服务：

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

## Nginx 反向代理示例

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

公网部署建议使用 HTTPS，并在反向代理层增加限流、Basic Auth、IP 白名单或 VPN 访问限制。

## 更新流程

更新代码前先备份学习库：

```bash
sudo systemctl stop ketwords
cp data/learning.sqlite data/learning.sqlite.bak
cp data/learning.sqlite-wal data/learning.sqlite-wal.bak 2>/dev/null || true
cp data/learning.sqlite-shm data/learning.sqlite-shm.bak 2>/dev/null || true
git pull
npm ci
sudo systemctl start ketwords
```

如果更新包含词库或离线资源变化，确认 `data/wordbank.sqlite`、`public/audio/`、`public/assets/fonts/` 和 `public/fonts.css` 已随代码同步。

## 离线资源刷新

通常不需要在生产环境运行。需要重新补齐中文释义、音标、音频或字体时执行：

```bash
npm run cache:offline
```

该命令会更新 `data/wordbank.sqlite` 和静态离线资源，不应该写入 `data/learning.sqlite`。

## 备份

服务启动后会每天自动备份到 `data/backups/`。备份内容包括：

- 当天的 `learning.sqlite` 快照。
- 同名的 `-wal`、`-shm` 文件，如果存在。
- 对应的 `-wordbank.sqlite` 词库快照。

默认保留 30 天，可用环境变量调整：

```bash
KET_BACKUP_RETENTION_DAYS=60
```

如果你已有外部备份系统，也可以关闭应用内自动备份：

```bash
KET_AUTO_BACKUP=0
```

## 故障排查

- 启动失败并提示缺少 `wordbank.sqlite`：说明词库基线没有部署到 `data/wordbank.sqlite`。
- 学习记录丢失：通常是 `data/learning.sqlite` 没有持久化、被覆盖或部署脚本误删。
- 登录失效：检查 `KET_SESSION_SECRET` 是否变更，或 `data/auth-config.json` 是否被重新生成。
- 音频缺失：确认 `public/audio/` 已部署；缺失时浏览器会回退到系统朗读。
