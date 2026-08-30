# The Tau Safety Model

Tau's core promise: **no AI-generated action reaches your machine without
passing a deterministic, tested gate that the AI does not control.**

## Principles

1. **AI proposes, code disposes.** The model's output is untrusted data until
   `validatePlanResponse()` (strict zod) and `reviewPlan()` (pure functions)
   have accepted it.
2. **The reviewer is deterministic.** No network, no randomness, no clock.
   Same plan → same verdict. Fully unit-tested, including benign near-misses.
3. **Dry-run by default.** `file.rename` and `text.replace` — the only
   first-party mutating tools — preview unless `execute:true` is explicit.
4. **No delete primitive.** There is deliberately no `file.delete` tool. The
   AI planner must never have a first-party deletion primitive. Deletion goes
   through shell steps — which are scanned, and which require confirmation.
5. **`--yes` is honest.** It auto-approves low risk (and medium only with
   `tau config set allowMediumAutoApprove true`). High risk always needs a
   human keystroke. Blocked is unreachable by anyone.
6. **Everything is recorded.** Every run — direct, planned, denied,
   cancelled — lands in `$TAU_HOME/history.jsonl`.

## Risk levels

| Level     | Meaning                                                          | What can run it                                 |
| --------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| `low`     | read-only / harmless output                                      | everyone, `--yes` included                      |
| `medium`  | mutating first-party tool, dry-run available                     | interactive confirm, or `--yes` + opt-in config |
| `high`    | caution-list shell ops (`rm`, `chmod`, `kill`, force git ops...) | interactive confirm ONLY                        |
| `blocked` | deny-list match or structural violation                          | NOBODY. Plan refused, exit 2                    |

## Deny list (verdict: deny, before any confirmation)

Highlights — see `packages/engine/src/core/safety.ts DENY_PATTERNS` for the full list:

- `rm -rf /` and home-directory recursive deletes
- `sudo`, `su` in any position
- `mkfs`, `dd ... of=/dev/*`, `> /dev/sd*`
- `curl … | sh` / `wget … | bash` (installer pipes)
- `chmod -R 777 /`, fork bombs `:(){ :|:& };:`
- `shutdown` / `reboot` / `halt` / `poweroff`
- `git push --force`, `DROP TABLE` / `DROP DATABASE`
- history erasure (`history -c`), known_hosts tampering

Each pattern ships with a paired test: the positive match AND a benign
look-alike that must NOT match (over-blocking is treated as a bug too).

## Caution list (escalate to high risk)

`rm`, `chown`, `chmod`, `kill/pkill/killall`, `git reset --hard` /
`git clean -f` / `git checkout --`, `npm publish/uninstall`, `pip uninstall`,
`curl`/`wget` (bare), writes into `/etc|/usr|/bin`, docker destructive ops,
`truncate`, `tee /etc/...`

## Structural limits

| Limit                | Value                                              |
| -------------------- | -------------------------------------------------- |
| steps per plan       | ≤ 10                                               |
| shell command length | ≤ 2000 chars                                       |
| output captured      | ≤ 200 KB (hard kill beyond)                        |
| command timeout      | config `timeout` (default 30 s)                    |
| tool args            | validated per-tool; unknown tool names → deny      |
| plan JSON            | zod `.strict()` — no extra keys, no invented enums |

## Network guards

- `net.fetch` refuses private/loopback/link-local targets unless
  `allowPrivate:true` (SSRF guard). Absolute http(s) URLs only.
- `net.ping` rejects shell metacharacters in the host (the tool spawns the
  system `ping`, so the host argument must be plain).
- `net.port` is single-host single-port by design; no port-range scanning.

## Skill safety

- Every skill command is scanned against the deny list at load time;
  matches become visible validation issues (never silent).
- Declarative commands declare their `risk`; the reviewer trusts exactly that
  declaration — nothing more.
- Skills are data: no code from a skill directory is ever executed implicitly.

## Non-goals

Tau is not a sandbox. It gates _what gets proposed and approved_; once you
confirm a high-risk step, the OS runs it with your permissions. For true
sandboxing, run Tau inside a container (see `.devcontainer/`).
