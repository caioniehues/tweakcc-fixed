# CONTEXT — tweakcc-fixed

Domain glossary. Terms here are canonical — issue titles, specs, and code
comments should use these words, not synonyms.

## Glossary

- **Showtime** — the recurring CC version-bump pipeline: bring tweakcc-fixed
  (the patcher) and LCC (the overrides repo) up to a newly released Claude
  Code, end-to-end to a green smoke test. Runbook: `skills/showtime/SKILL.md`;
  rationale/bug classes: `skills/showtime/REFERENCE.md`.
- **LCC** — lobotomized-claude-code, the sibling overrides repo
  (`~/Projects/lobotomized-claude-code`); its active per-model pack is
  symlinked at `~/.tweakcc/system-prompts`.
- **The four zeros** — showtime's completion bar: smoke READY; clean apply
  hygiene; 0 orphan overrides; 0 latent var breakage (+ `auditMisbinds` exit 0).
- **Detector** — the systemd user timer + script that polls npm's `latest`
  dist-tag for `@anthropic-ai/claude-code` and launches a gated run on a new
  version (ADR-0001).
- **Gated run** — an unattended headless showtime session that runs phases 0–7
  and hard-stops at _the gate_.
- **The gate** — the boundary a gated run must not cross: no `--apply`, no
  commits, no pushes. Enforced instructionally (SKILL.md) and structurally
  (marker file + deny hook).
- **Marker file** — created at gated-run launch, removed at landing; its
  presence makes the PreToolUse hook deny `git push` and `--apply`.
- **Land / landing** — the human step after reviewing a gated run's summary:
  resume the session, execute the held phases (apply, smoke, commit, push,
  close the run issue), remove the marker.
- **Run issue / run summary** — the per-release GitHub issue and the summary
  file (`~/.tweakcc/showtime-runs/<version>.md`) a gated run produces; the
  summary records the session id to resume.
- **Supersede** — a newer CC version shipping while a gated run awaits review.
  Policy: hold-and-annotate, never auto-relaunch (ADR-0001 §5).

## Decisions

See `docs/adr/`. Start with ADR-0001 (gated showtime automation).
