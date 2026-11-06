#!/usr/bin/env bash
# Cold snapshot of SQLite, files, and instance configuration; encrypted with restic.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
deploy_dir=${PRFROG_DEPLOY_DIR:-/opt/prfrog/deploy/scaleway}
backup_env=${PRFROG_BACKUP_ENV:-/etc/prfrog/backup.env}
snapshot_dir=${PRFROG_SNAPSHOT_DIR:-/var/backups/prfrog}
compose_project=${PRFROG_COMPOSE_PROJECT:-prfrog}
compose_env=${PRFROG_COMPOSE_ENV:-.env}
umask 077
exec 9>/run/lock/prfrog-backup.lock
flock -n 9 || { echo 'A backup is already running.' >&2; exit 1; }
set -a
source "$backup_env"
set +a
: "${RESTIC_REPOSITORY:?Missing backup repository}"
: "${RESTIC_PASSWORD_FILE:?Missing restic password file}"
cd "$deploy_dir"
compose=(docker compose --env-file "$compose_env" -f compose.yaml -p "$compose_project")
container=$("${compose[@]}" ps -q backend)
[[ -n $container ]] || { echo 'Backend is not running.' >&2; exit 1; }
volume=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/convex/data"}}{{.Source}}{{end}}{{end}}')
[[ -d $volume ]] || { echo 'Backend data volume not found.' >&2; exit 1; }
install -d -m 0700 "$snapshot_dir"
restic cat config >/dev/null
restart_needed=1
trap 'if [[ ${restart_needed:-0} == 1 ]]; then "${compose[@]}" start backend; fi' EXIT
"${compose[@]}" stop backend
tar --numeric-owner -C "$volume" -cf "$snapshot_dir/data.tar.partial" .
mv "$snapshot_dir/data.tar.partial" "$snapshot_dir/data.tar"
cp "$compose_env" "$snapshot_dir/instance.env"
cp compose.yaml Caddyfile "$snapshot_dir/"
git -C "$deploy_dir" rev-parse HEAD > "$snapshot_dir/revision.txt"
"${compose[@]}" start backend
restart_needed=0
restic backup --tag prfrog "$snapshot_dir"
restic forget --tag prfrog --keep-daily 7 --keep-weekly 4 --keep-monthly 6
restic check
