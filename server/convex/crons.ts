// Convex re-runs a query when data changes, never because time passed. A run
// whose workflow never reports back would sit open forever, so this is the one
// place a clock has to act on the data.

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep stale runs", { minutes: 5 }, internal.runs.sweepStale, {});
crons.interval("refresh codex usage", { minutes: 15 }, internal.usage.refresh, {});
crons.interval("read idle pooled codex quota", { minutes: 15 }, internal.codexQuota.refreshIdle, {});
crons.interval("expire webhook deliveries", { hours: 6 }, internal.webhooks.expireDeliveries, {});
crons.interval("recover failed webhook deliveries", { minutes: 5 }, internal.webhookRecovery.redeliverFailed, {});

export default crons;
