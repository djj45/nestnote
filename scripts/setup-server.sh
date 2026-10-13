#!/usr/bin/env bash
# 服务器一次性准备（重复运行也没关系）：
# 建 note 用户和目录，安装配置文件、systemd 服务、每日备份定时器、nginx 站点。
# 不会改动其它站点和服务；nginx 只是"检查配置 + 平滑重载"。
set -euo pipefail

cd "$(dirname "$0")/.."
# 自己的服务器和域名写在 deploy.local.env（不提交到 git），格式见 deploy.local.env.example
[ -f deploy.local.env ] && . ./deploy.local.env
HOST="${NOTE_DEPLOY_HOST:?请在 deploy.local.env 里设置 NOTE_DEPLOY_HOST（ssh 主机名）}"
DOMAIN="${NOTE_DOMAIN:?请在 deploy.local.env 里设置 NOTE_DOMAIN（域名）}"
CERT_DIR="${NOTE_CERT_DIR:-/etc/letsencrypt/live/$DOMAIN}"

# 把配置模板里的 __DOMAIN__、__CERT_DIR__ 换成真实的值再上传
RENDER="$(mktemp -d)"
trap 'rm -rf "$RENDER"' EXIT
cp -p deploy/* "$RENDER/"
for f in "$RENDER"/*; do
  sed -i.bak -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__CERT_DIR__|$CERT_DIR|g" "$f" && rm -f "$f.bak"
done

ssh "$HOST" "rm -rf /tmp/note-setup && mkdir -p /tmp/note-setup"
rsync -az "$RENDER/" "$HOST:/tmp/note-setup/"

ssh "$HOST" "DOMAIN='$DOMAIN' bash -s" <<'REMOTE'
set -euo pipefail
cd /tmp/note-setup

# 专门运行笔记服务的系统用户（不能登录）
id note >/dev/null 2>&1 || sudo useradd --system --home-dir /var/lib/note --shell /usr/sbin/nologin note

sudo install -d -o root -g root -m 755 /opt/note /opt/note/web /opt/note/server
sudo install -d -o note -g note -m 750 /var/lib/note /var/backups/note
sudo install -d -o root -g root -m 755 /etc/note

# 配置文件已存在就不覆盖（可能手动改过）
[ -f /etc/note/note.env ] || sudo install -o root -g note -m 640 note.env /etc/note/note.env
sudo install -o root -g root -m 755 note-passwd /usr/local/bin/note-passwd

sudo install -o root -g root -m 644 note.service note-backup.service note-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable note.service note-backup.timer
sudo systemctl start note-backup.timer

# nginx 站点：先检查配置，有问题就撤回，不影响现有站点
sudo install -o root -g root -m 644 nginx-note.conf "/etc/nginx/sites-available/$DOMAIN"
sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
if sudo nginx -t; then
  sudo systemctl reload nginx
else
  sudo rm -f "/etc/nginx/sites-enabled/$DOMAIN"
  echo "nginx 配置检查没通过，已撤回笔记站点" >&2
  exit 1
fi

rm -rf /tmp/note-setup
echo "服务器准备完成"
REMOTE
