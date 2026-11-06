#!/usr/bin/env bash
# Run on the PR Frog VM after joining the company tailnet.
set -euo pipefail
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
sudo tailscale serve --bg --https=8444 http://127.0.0.1:3210
sudo tailscale serve --bg --https=8445 http://127.0.0.1:3211
# This port publishes only the routes permitted by Caddyfile.
sudo tailscale funnel --bg --https=8443 http://127.0.0.1:8080
sudo tailscale serve status
sudo tailscale funnel status
