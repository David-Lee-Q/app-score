#!/bin/bash
set -e

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

node server/index.js &
SERVER_PID=$!

trap "kill $SERVER_PID" EXIT

npm run dev
