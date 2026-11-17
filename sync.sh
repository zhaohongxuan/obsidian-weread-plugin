#!/bin/sh
set -eu

for target in \
    "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/xuan/.obsidian/plugins/obsidian-weread-plugin" \
    "$HOME/Developer/Weread/.obsidian/plugins/obsidian-weread-plugin"; do
    rsync -av \
        --include='/main.js' \
        --include='/manifest.json' \
        --include='/style.css' \
        --exclude='*' \
        ./dist/ "$target/"
done
