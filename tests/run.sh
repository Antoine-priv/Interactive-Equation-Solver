#!/bin/bash
# Runs every regression script in this directory with Playwright. See README.md for setup.
cd "$(dirname "$0")"
export NODE_PATH="$PWD/node_modules"
rm -f screenshots/*.png
FAIL=0

shopt -s nullglob

for f in *.js; do
  out=$(timeout 40 node "$f" 2>&1)
  code=$?
  realerr=$(echo "$out" | grep -E "\[pageerror\]|\[console\.error\]")
  if [ $code -ne 0 ] || [ -n "$realerr" ]; then
    echo "=== FAIL: $f (exit $code) ==="
    echo "$out" | tail -30
    FAIL=1
  fi
done

if [ $FAIL -eq 0 ]; then echo "ALL REGRESSION SCRIPTS OK"; fi
exit $FAIL
