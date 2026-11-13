#!/bin/sh
# Build the app and publish web/dist as the gh-pages branch of origin.
set -e
cd "$(dirname "$0")/.."
npx vite build
remote=$(git remote get-url origin)
cd dist
touch .nojekyll
git init -q -b gh-pages
git add -A
git commit -qm "Deploy"
git push -f "$remote" gh-pages
rm -rf .git
