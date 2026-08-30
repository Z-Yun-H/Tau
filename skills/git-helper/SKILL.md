---
name: git-helper
version: 0.1.0
description: Read-only git workflow shortcuts — status, recent log, branch overview, diff stats
author: ZHYun
tags: [git, vcs]
risk: low
triggers: [git, commit, branch, log, 状态, 提交]
commands:
  - name: status
    description: Show working tree status with branch info
    command: git status --short --branch
    risk: low
  - name: log
    description: Show the last 10 commits compactly
    command: git log --oneline -10
    risk: low
  - name: branches
    description: List local branches with latest commit
    command: git branch -v
    risk: low
  - name: diffstat
    description: Show diff statistics of uncommitted changes
    command: git diff --stat
    risk: low
---

# git-helper

Read-only git conveniences. Every command here is declarative, low-risk, and
safe to expose to the AI planner: they only _look_, they never mutate.

## Why declarative commands

Skill commands are registered as tools named `<skill>.<command>` (e.g.
`git-helper.status`) at CLI startup. That means:

- Humans: `tau git-helper status`
- The AI planner: sees them in its catalog and can propose them as tool steps
- The safety reviewer: trusts them up to their declared risk level

## Deliberately excluded

`push`, `reset --hard`, `clean`, `commit --amend` — mutating git state is what
the reviewed-shell-plan path (with confirmation UI) is for. Keep it that way
unless you enjoy losing work.
