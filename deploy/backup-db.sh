#!/usr/bin/env bash
# Daily off-box backup of the SQLite DB to a private git repo.
# Installed at /opt/airbnbadmin-backups/backup-db.sh and run by cron (see DEPLOY.md).
#
# Uses `sqlite3 .backup` for a consistent snapshot even while the app is running.
# The backup repo must already be cloned at $BACKUP_REPO with a working git remote
# (via a deploy key). See DEPLOY.md for setup.

set -euo pipefail

DB_PATH="/opt/AirbnbAdmin/data/airbnb.db"
BACKUP_REPO="/opt/airbnbadmin-backups"
SNAPSHOT="$BACKUP_REPO/airbnb.db"

# Consistent snapshot (safe during writes).
sqlite3 "$DB_PATH" ".backup '$SNAPSHOT'"

cd "$BACKUP_REPO"
git add airbnb.db
# Commit only if something changed. Date stamp comes from the system clock.
if ! git diff --cached --quiet; then
	git commit -m "backup $(date -u +%Y-%m-%dT%H:%M:%SZ)"
	git push origin main
	echo "backup pushed"
else
	echo "no changes — skipped"
fi
