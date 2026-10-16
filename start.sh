#!/bin/bash
set -e

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# 前端构建产物由后端（Express）统一托管，单服务单端口
npm run build

exec node server/index.js
