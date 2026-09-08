#!/usr/bin/env bash
# Provisions the Python runtime for the procedural puzzle engine.
# Creates a project-local virtualenv at puzzles/.venv and installs
# puzzles/requirements.txt into it. Works on Render (build venv) and CI.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python

"$PY" -m venv puzzles/.venv
puzzles/.venv/bin/pip install --quiet --upgrade pip
puzzles/.venv/bin/pip install --quiet -r puzzles/requirements.txt
puzzles/.venv/bin/python -c "import fastapi, pydantic"

echo "Puzzle engine venv ready at puzzles/.venv"
