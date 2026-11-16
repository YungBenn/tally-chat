import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("close stuck replies", { minutes: 5 }, internal.chat.sweepStuckReplies, {});
crons.interval("remove unsent documents", { hours: 1 }, internal.documents.sweepUnsent, {});
export default crons;
