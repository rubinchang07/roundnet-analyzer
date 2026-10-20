#!/usr/bin/env bash
# Creates the roundnet schema and the Analyzer loader in the target database.
#
#   scripts/setup.sh            create the schema, or just refresh the loader
#                               functions if the schema already exists
#   scripts/setup.sh --reset    drop the roundnet schema (and all its data) first
#
# Connection settings come from the usual libpq variables (PGHOST, PGPORT,
# PGUSER, PGPASSWORD, PGDATABASE) or a DATABASE_URL.
set -euo pipefail
DB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
run_psql() { psql ${DATABASE_URL:+"$DATABASE_URL"} -X -q -v ON_ERROR_STOP=1 "$@"; }

if [[ "${1:-}" == "--reset" ]]; then
    run_psql -c 'DROP SCHEMA IF EXISTS roundnet CASCADE'
fi

if [[ "$(run_psql -At -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'roundnet'")" == 1 ]]; then
    run_psql -f "$DB_DIR/import_analyzer.sql"
    echo "roundnet schema already exists; loader functions refreshed"
else
    run_psql -f "$DB_DIR/ddl.sql" -f "$DB_DIR/import_analyzer.sql"
    echo "roundnet schema created"
fi
