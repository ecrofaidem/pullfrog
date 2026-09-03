#!/usr/bin/env node
// Prints an HTML page that submits a GitHub App manifest for the org, so the
// App is created with the exact permissions, events and URLs the server needs.
// After GitHub redirects back with ?code=..., exchange it with:
//   curl -X POST https://api.github.com/app-manifests/<code>/conversions
// which returns id, slug, pem, webhook_secret, client_id and client_secret.
//
// usage: node scripts/github-app-manifest.mjs --org ecrofaidem --site https://x.convex.site \
//          --dashboard https://frogbot.example.workers.dev --redirect https://x.convex.site/healthz > /tmp/app.html

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const { org, site, dashboard, redirect, name = "frogbot" } = args;
if (!org || !site || !dashboard || !redirect) {
  console.error("need --org --site --dashboard --redirect");
  process.exit(1);
}

const manifest = {
  name,
  url: dashboard,
  description: "Reviews pull requests with a coding agent on a ChatGPT Codex subscription.",
  hook_attributes: { url: `${site}/webhooks/github`, active: true },
  redirect_url: redirect,
  callback_urls: [`${dashboard}/api/auth/callback/github`],
  setup_on_update: false,
  public: false,
  default_permissions: {
    actions: "write",
    checks: "write",
    contents: "write",
    issues: "write",
    pull_requests: "write",
    workflows: "write",
    metadata: "read",
    members: "read",
  },
  default_events: [
    "installation_repositories",
    "pull_request",
    "issue_comment",
    "workflow_run",
  ],
};

const state = Math.random().toString(36).slice(2, 10);
const action = `https://github.com/organizations/${org}/settings/apps/new?state=${state}`;
const json = JSON.stringify(manifest).replace(/"/g, "&quot;");

process.stdout.write(`<!doctype html>
<meta charset="utf-8">
<title>Create the ${name} GitHub App</title>
<body style="font: 15px system-ui; padding: 2rem; max-width: 60ch">
<h1 style="font-size: 1.25rem">Create the <code>${name}</code> GitHub App on ${org}</h1>
<p>Submitting this form sends the manifest below to GitHub, which asks you to confirm and then redirects back to <code>${redirect}</code> with a one-time code.</p>
<form method="post" action="${action}">
  <input type="hidden" name="manifest" value="${json}">
  <button type="submit" style="font: inherit; padding: .5rem 1rem">Create GitHub App</button>
</form>
<pre style="white-space: pre-wrap; font-size: 12px; margin-top: 2rem">${JSON.stringify(manifest, null, 2)}</pre>
`);
