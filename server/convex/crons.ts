// Convex re-runs a query when data changes, never because time passed. A run
// whose workflow never reports back would sit open forever, so this is the one
// place a clock has to act on the data.

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep stale runs", { minutes: 5 }, internal.runs.sweepStale, {});
crons.interval("refresh codex usage", { minutes: 15 }, internal.usage.refresh, {});

export default crons;
