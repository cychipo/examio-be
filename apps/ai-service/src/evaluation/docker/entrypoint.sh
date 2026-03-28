#!/usr/bin/env sh
set -eu

python -m src.evaluation.scripts.run_benchmark "$@"
