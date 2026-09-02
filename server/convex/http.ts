// Route table. Everything the forked action calls lives under /api and speaks
// the closed Pullfrog server's contract; anything it calls that we do not
// implement (proxy-token, learnings, summary comments) falls through to
// Convex's 404, which the action treats as "feature unavailable".

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { cliSecretsGet, cliSecretsPost } from "./handlers/cliSecrets";
import { installationToken } from "./handlers/installationToken";
import { runContext } from "./handlers/runContext";
import { runtimeSecretPut } from "./handlers/runtimeSecret";
import { githubWebhook } from "./handlers/webhook";
import { workflowRunPatch } from "./handlers/workflowRun";
import { json } from "./lib/http";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({ path: "/healthz", method: "GET", handler: httpAction(async () => json({ ok: true })) });

http.route({ path: "/api/github/installation-token", method: "POST", handler: installationToken });
http.route({ pathPrefix: "/api/repo/", method: "GET", handler: runContext });
http.route({ path: "/api/runtime/secret", method: "PUT", handler: runtimeSecretPut });
http.route({ pathPrefix: "/api/workflow-run/", method: "PATCH", handler: workflowRunPatch });
http.route({ path: "/api/cli/secrets", method: "GET", handler: cliSecretsGet });
http.route({ path: "/api/cli/secrets", method: "POST", handler: cliSecretsPost });

http.route({ path: "/webhooks/github", method: "POST", handler: githubWebhook });

export default http;
