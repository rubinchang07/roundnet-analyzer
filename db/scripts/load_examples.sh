#!/usr/bin/env bash
# Creates the schema if needed and loads every export in examples/, using the
# matching file in examples/match_info/ when there is one. Safe to re-run:
# exports that are already loaded are skipped.
set -euo pipefail
DB_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$DB_DIR/scripts/setup.sh"
for f in "$DB_DIR"/examples/*.json; do
    info="$DB_DIR/examples/match_info/$(basename "$f")"
    printf '%-50s ' "$(basename "$f")"
    if [[ -f "$info" ]]; then
        "$DB_DIR/scripts/import.sh" "$f" "$info"
    else
        "$DB_DIR/scripts/import.sh" "$f"
    fi
done
