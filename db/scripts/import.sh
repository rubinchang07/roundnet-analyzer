#!/usr/bin/env bash
# Loads one Roundnet Analyzer JSON export.
#
#   scripts/import.sh roundnet-match.json [match-info.json]
#
# match-info.json is optional: tournament, round, played_at and other context
# the export doesn't carry (see ../import_format.md). Prints the match id, or
# the reason the file was rejected (and exits 1).
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "usage: $0 EXPORT.json [MATCH_INFO.json]" >&2
    exit 2
fi
export_file="$1"
info_file="${2:-}"

result="$(psql ${DATABASE_URL:+"$DATABASE_URL"} -X -q -At -v ON_ERROR_STOP=1 \
     -v export_file="$export_file" -v info_file="${info_file:-/dev/null}" \
     -v file_name="$(basename "$export_file")" <<'SQL'
\set content `cat :'export_file'`
\set info `cat :'info_file'`
SELECT coalesce(roundnet.import_analyzer_export(:'content'::jsonb, :'file_name',
                    coalesce(nullif(:'info', ''), '{}')::jsonb)::text, '') AS match_id \gset
SELECT CASE WHEN :'match_id' = ''
            THEN 'rejected: ' || (SELECT error FROM roundnet.import_batch
                                   WHERE file_name = :'file_name'
                                   ORDER BY import_batch_id DESC LIMIT 1)
            ELSE 'match ' || :'match_id' || coalesce(
                     (SELECT ' (' || jsonb_array_length(b.warnings) || ' warning(s), see roundnet.import_batch)'
                        FROM roundnet.import_batch b
                       WHERE b.import_batch_id = (SELECT max(import_batch_id) FROM roundnet.game
                                                   WHERE match_id = nullif(:'match_id', '')::bigint)),
                     '')
       END;
SQL
)"
echo "$result"
[[ "$result" != rejected:* ]]
