#!/usr/bin/env bash
# Run the TLA+ models with TLC if tla2tools.jar is available.
#
# TLC requires Java (present) and tla2tools.jar. We do NOT vendor the jar. If it
# is not found, this script prints how to obtain it and exits 0 so CI can rely on
# the equivalent TypeScript checker (`npm run formal`) as the enforcing gate.
#
# To obtain TLC:
#   curl -L -o tla2tools.jar https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
set -euo pipefail
cd "$(dirname "$0")/tla"

JAR="${TLA2TOOLS_JAR:-tla2tools.jar}"
if [[ ! -f "$JAR" ]]; then
  echo "tla2tools.jar not found. The authoritative TLA+ specs are present in $(pwd)."
  echo "Install TLC to model-check them, or run 'npm run formal' for the equivalent TS check."
  echo "  curl -L -o tla2tools.jar https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar"
  exit 0
fi

echo "== Model checking Capability.tla =="
java -cp "$JAR" tlc2.TLC -config Capability.cfg Capability.tla

echo "== Model checking Promotion.tla =="
java -cp "$JAR" tlc2.TLC -config Promotion.cfg Promotion.tla
