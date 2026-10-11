#!/usr/bin/env bash
# Builds the app and publishes dist/ to the gh-pages branch (GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="wata9857-ops" -c user.email="wata9857@gmail.com" commit -q -m "Deploy $(git -C .. rev-parse --short HEAD)"
git push -f "$(git -C .. remote get-url origin)" gh-pages
rm -rf .git
