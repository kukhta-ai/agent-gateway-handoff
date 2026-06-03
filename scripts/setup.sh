#!/usr/bin/env bash
# Bootstrap the SDLC tooling for this project (stack-agnostic).
#
# Installs the Backlog.md CLI and the BMAD modules the SDLC in AGENTS.md uses. These are the
# language-AGNOSTIC agent tools the process runs on — they operate on any codebase regardless of the
# project's own language. The BMAD install is COMMITTED to your project (the .gitignore does not exclude
# it); run this once at project init, commit the result, and re-run to update. Personal config stays local.
#
# Prerequisite: Node.js + npm (only to RUN the agent tooling). Your project's own language toolchain is a
# separate concern — see the TODO at the end (and the README's "Dependencies" section).
set -euo pipefail

# Pinned versions — bump deliberately, then record them in .bmad/sdlc-state.yaml > tooling.
BACKLOG_MD_VERSION="${BACKLOG_MD_VERSION:-1.45.2}"
BMAD_VERSION="${BMAD_VERSION:-6.8.0}"

echo "==> Installing Backlog.md CLI (backlog.md@${BACKLOG_MD_VERSION}) globally"
npm install -g "backlog.md@${BACKLOG_MD_VERSION}"

echo "==> Installing BMAD core method + test architecture (modules: bmm, tea)"
npx --yes "bmad-method@${BMAD_VERSION}" install --modules bmm,tea

echo "==> Installing the autonomous build loop (module: automator)"
npx --yes "bmad-method@${BMAD_VERSION}" install --modules automator

cat <<'EOF'

==> Bootstrap complete.

Next steps:
  1. Set this project's name in the backlog (operate backlog ONLY via the CLI, never by hand):
       backlog config set project_name "<name>"     # see: backlog config --help
       # (or re-run 'backlog init' if your Backlog.md version prefers that flow)
  2. Fill in the Quality gate in CONTRIBUTING.md, and mirror it into:
       - backlog/config.yml  > definition_of_done
       - .github/workflows/ci.yml  (the gate steps)
       - your pre-commit hook
  3. Record the installed tool versions in .bmad/sdlc-state.yaml > tooling.
  4. Read AGENTS.md + docs/, then begin the SDLC at Phase 1.

NOTE: this installed the language-AGNOSTIC SDLC tooling only.
TODO: install your project's own language toolchain and wire its build / lint / test
      commands into the quality gate above.
EOF
