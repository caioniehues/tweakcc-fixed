# ADR-0001 — Gated showtime automation

**Status:** Accepted (2026-07-24)
**Context:** grilling session 2026-07-24; research in `docs/research/detecting-claude-code-releases.md`

## Context

Claude Code releases ~daily (median gap ~24h). Every release triggers the manual
"showtime" pipeline (`skills/showtime/SKILL.md`): extract prompts, drive the
four zeros, realign LCC overrides, commit/push both repos. The goal is to
automate as much of this as possible. The pipeline is local-machine-bound: it
patches the installed native CC binary, smoke-tests via `claude --print`, and
reads `~/.tweakcc` symlinks — so cloud-only execution (GitHub Actions, scheduled
cloud agents) cannot run it.

## Decisions

### 1. Gated automation, not fully hands-off

On detection, a headless Claude session runs showtime phases 0–7 automatically
(ground, update, extract, report, realignment, README/lint/test/build) and
**hard-stops before `--apply`, commits, and pushes** — the _gate_. The human
reviews a run summary and _lands_ the run. Fully hands-off is the aspiration
once the gated form proves itself over several releases.

_Why:_ the smoke test patches the daily-driver binary; the gotcha catalog is
full of "apply clean, content silently wrong" failure modes where the human
read of the summary is the last defense.

### 2. Detection is a local systemd user timer polling npm

2-hourly with jitter (`RandomizedDelaySec`), `Persistent=true`. Polls the npm
dist-tags endpoint (uncached, 56 bytes; see the research doc) and tracks the
**`latest`** dist-tag (what the native installer follows — `stable` lags),
comparing against the newest `data/prompts/prompts-*.json`. npm leads GitHub
Releases by hours, so npm is the trigger; GitHub feeds are human-facing only.

### 3. Pre-gate `claude update` is allowed

The gate protects patching and pushes, **not** the vanilla binary update — CC
auto-updates on its own schedule anyway, so an updated-but-unpatched
(unlobotomized) CC for a bounded window is the normal post-update state, not a
disruption the automation introduces. The alternative (sandboxed out-of-band
extraction) would fork the driver's extraction path permanently; rejected.

### 4. The gate lives in the showtime skill, backstopped by a hook

One canonical runbook: `SKILL.md` gains a gated trigger ("it's showtime —
gated") rather than a wrapper skill that would drift. Because the headless run
uses `--dangerously-skip-permissions`, the gate is also **structural**: the run
creates a marker file at launch; a PreToolUse deny hook blocks `git push` and
`--apply` while the marker exists. Landing removes the marker.

### 5. One gated run in flight; hold-and-annotate on supersede

A lock file prevents concurrent/duplicate launches, and the detector refuses to
launch onto a dirty tree. If a newer CC version ships while a gated run awaits
review, the timer does **not** supersede automatically — it comments on the open
run issue and re-notifies; the human lands or retargets. (The 2-hourly timer is
itself the queue: after landing, the next tick picks up the newer version.)

### 6. Surfacing: notification + summary file + GitHub issue per run

The run writes `~/.tweakcc/showtime-runs/<version>.md` (counters, session id to
resume), fires `notify-send`, and opens a GitHub issue on this repo (phone
reach, per-release audit record, closed on landing).

### 7. Cost: default model main loop

The unattended session runs on the default configured model; the standing
subagent cost rule (haiku for mechanical, sonnet for moderate) governs fan-outs
inside the run. Judgment quality in realignment triage outweighs main-loop
savings.

## Consequences

- Finishing the in-flight manual bump (dirty trees block the detector) is what
  arms the automation.
- The human's job shrinks to: read one summary, say "land it" (resume the
  session), watch the held phases execute.
- The deny hook is repo-level and marker-scoped, so interactive sessions are
  unaffected when no gated run is pending.
