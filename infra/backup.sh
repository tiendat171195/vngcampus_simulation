#!/bin/sh
# Nightly database dump (docs/09 §6): pg_dump in custom format into /backups at BACKUP_AT
# (container time, TZ), keeping BACKUP_KEEP_DAYS days. Copy /backups off the machine as well
# (see docs/runbook.md); a backup on the same disk does not survive losing the disk.
set -eu
BACKUP_AT="${BACKUP_AT:-02:30}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p /backups

dump() {
  file="/backups/campus-$(date +%Y%m%d-%H%M%S).dump"
  if pg_dump --format=custom --no-owner --file="$file.partial"; then
    mv "$file.partial" "$file"
    date -u +%Y-%m-%dT%H:%M:%SZ > /backups/last-success
    echo "backup: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "backup: FAILED" >&2
  fi
  find /backups -name 'campus-*.dump' -mtime "+$BACKUP_KEEP_DAYS" -delete
}

# A fresh machine gets a first backup right away rather than waiting for the night.
[ -f /backups/last-success ] || dump
while true; do
  [ "$(date +%H:%M)" = "$BACKUP_AT" ] && dump
  sleep 60
done
