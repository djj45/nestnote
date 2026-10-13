#!/usr/bin/env bash
# 一键部署：在 Mac 上构建，上传到服务器，重启服务。
#   npm run deploy            （或 bash scripts/deploy.sh）
# 第一次部署前要先运行一次 scripts/setup-server.sh。
set -euo pipefail

cd "$(dirname "$0")/.."
# 自己的服务器和域名写在 deploy.local.env（不提交到 git），格式见 deploy.local.env.example
[ -f deploy.local.env ] && . ./deploy.local.env
HOST="${NOTE_DEPLOY_HOST:?请在 deploy.local.env 里设置 NOTE_DEPLOY_HOST（ssh 主机名）}"
DOMAIN="${NOTE_DOMAIN:?请在 deploy.local.env 里设置 NOTE_DOMAIN（域名）}"
STAGE="/tmp/note-deploy"

echo "==> 1/3 类型检查和构建"
npm run build

echo "==> 2/3 上传到 $HOST"
ssh "$HOST" "rm -rf $STAGE && mkdir -p $STAGE"
rsync -az apps/web/dist/ "$HOST:$STAGE/web/"
rsync -az apps/server/dist/ "$HOST:$STAGE/server/"

echo "==> 3/3 安装并重启"
ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
# 网页：不删除旧的 js/css，正开着旧页面的设备还能加载到
sudo rsync -a --chown=root:root $STAGE/web/ /opt/note/web/
sudo rsync -a --delete --chown=root:root $STAGE/server/ /opt/note/server/
rm -rf $STAGE
sudo systemctl restart note
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8790/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active note >/dev/null || { sudo journalctl -u note -n 30 --no-pager; exit 1; }
echo "服务状态：\$(curl -fsS http://127.0.0.1:8790/api/health)"
REMOTE

echo "==> 部署完成：https://$DOMAIN"
