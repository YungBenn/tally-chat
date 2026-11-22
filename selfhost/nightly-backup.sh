#!/bin/sh
# Nightly backup for launchd or cron: runs backup.sh into $TALLY_BACKUP_DIR (default
# ~/tally-backups/nightly), then deletes backups older than 14 days. Old backups are only
# deleted after a successful run. Every run appends to $TALLY_BACKUP_LOG (default
# ~/Library/Logs/tally-backup.log); a failure is logged as a FAILED line and, on macOS, shown
# as a notification.
set -u
dest=${TALLY_BACKUP_DIR:-$HOME/tally-backups/nightly}
log=${TALLY_BACKUP_LOG:-$HOME/Library/Logs/tally-backup.log}
keep_days=14
mkdir -p "$dest" "$(dirname "$log")" && chmod 700 "$dest"
stamp() { date '+%Y-%m-%d %H:%M:%S'; }

if out=$("$(dirname "$0")/backup.sh" "$dest" 2>&1); then
  echo "$(stamp) ok: $(echo "$out" | tail -1)" >> "$log"
  # tally-YYYYmmdd-HHMMSS directories older than the retention window
  find "$dest" -maxdepth 1 -type d -name 'tally-*' -mtime +$((keep_days - 1)) -print -exec rm -rf {} + |
    sed "s|^|$(stamp) pruned |" >> "$log"
else
  rmdir "$dest"/tally-* 2>/dev/null # the empty directory a failed run leaves behind
  { echo "$(stamp) FAILED: tally.chat backup"; echo "$out" | tail -20 | sed 's/^/    /'; } >> "$log"
  command -v osascript >/dev/null && osascript -e "display notification \"See $log\" with title \"tally.chat backup failed\""
  exit 1
fi
