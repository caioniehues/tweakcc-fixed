# Linux Testing

Run these on the VPS (no checkout needed — the published npm package is the
distribution path):

```bash
npx -y tweakcc-fixed@latest --apply
claude --version
npx -y tweakcc-fixed@latest --restore
```

Success looks like:

- `--apply` detects the Linux ELF `claude` binary, applies the saved
  theme/customization patches, and exits without codesigning.
- `claude --version` still prints the Claude Code version after patching.
- `--restore` restores the backup cleanly.

To test **unpublished** changes on Linux, build from a checkout instead:

```bash
cd ~/dev/tweakcc-fixed && git pull && pnpm install && pnpm build
node dist/index.mjs --apply
```
