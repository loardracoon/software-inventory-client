#!/bin/sh
# Turns on the repository's git hooks (.githooks/pre-commit: secret scan of staged changes). Run once per clone:
#   sh scripts/install-git-hooks.sh
set -eu
cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/pre-commit 2>/dev/null || true
git config core.hooksPath .githooks
echo "Git hooks on: core.hooksPath = .githooks (pre-commit runs gitleaks on staged changes)"
