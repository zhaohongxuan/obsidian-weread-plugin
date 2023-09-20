#!/bin/sh
rsync -av --delete --include={"main.js",'manifest.json'} --exclude='*' ./dist/ ~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/xuan/.obsidian/plugins/obsidian-weread-plugin