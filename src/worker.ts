import { Hono } from "hono";
import { activity } from "./activity/routes.ts";
import { attachmentFiles, attachments } from "./attachments.ts";
import { calendar } from "./calendar/routes.ts";
import { directory } from "./clients/routes.ts";
import {
	accessDoor,
	type CompareEnv,
	compareDoor,
	oldReads,
} from "./compare-door.ts";
import { connection } from "./connection.ts";
import { dealClosing } from "./deal-closing.ts";
import { dealField } from "./deal-field.ts";
import { dealUpdate } from "./deal-update.ts";
import { nextDeals } from "./deals/next-change.ts";
import { deals } from "./deals/routes.ts";
import { invoices } from "./invoices.ts";
import { leads } from "./leads/routes.ts";
import { jobStamp, type NextSaveEnv, userStamp } from "./next-door.ts";
import { nextStep } from "./next-step.ts";
import { nextSteps } from "./next-steps.ts";
import { type IntakeEnv, intake } from "./post-intake.ts";
import { presence } from "./presence.ts";
import { relationships } from "./relationships/routes.ts";
import { replyJobs, replySubmissions } from "./reply-drafts.ts";
import { search } from "./search/routes.ts";
import { requireSession } from "./session.ts";
import { today } from "./today/routes.ts";
import { vendorMarkets } from "./vendors/market-routes.ts";
import { vendorMeetings } from "./vendors/meeting-routes.ts";

type WorkerEnv = NextSaveEnv &
	CompareEnv &
	IntakeEnv & {
		Bindings: { CF_VERSION_METADATA: { id: string } };
	};

// Routes match the raw path as the old door did, but still decode their values.
const app = new Hono<WorkerEnv>({
	getPath: (request) => new URL(request.url).pathname,
});
app.notFound((c) => c.json({ error: "not_found" }, 404));

app.get("/health", (c) =>
	c.json({ ok: true, version: c.env.CF_VERSION_METADATA.id }),
);

const engine = new Hono<WorkerEnv>()
	.get("/whoami", (c) => c.json(c.get("partner")))
	.route("/", activity)
	.route("/", calendar)
	.route("/", directory)
	.route("/", connection)
	.route("/", deals)
	.route("/", dealField)
	.route("/", dealClosing)
	.route("/", dealUpdate)
	.route("/", invoices)
	.route("/", leads)
	.route("/", nextStep)
	.route("/", presence)
	.route("/", relationships)
	.route("/", search)
	.route("/", today)
	.route("/", vendorMarkets)
	.route("/", vendorMeetings);

app.use("/api/engine/*", requireSession, userStamp);
app.route("/api/engine", engine);
app.route("/api/engine", nextDeals);
app.route("/api/engine", nextSteps);
app.route("/api/engine", attachmentFiles);
app.route("/api/engine", replySubmissions);

// The app forwards only /api/engine/*, so this door is reached directly.
app.use(
	"/compare/*",
	accessDoor("compare", (env) => env.ACCESS_AUD),
	compareDoor,
);
app.route("/compare/:partner/engine", engine);
app.route("/compare/:partner/old", oldReads);

// The Friday batch hands its posts to the engine here.
app.use(
	"/intake/*",
	accessDoor("intake", (env) => env.INTAKE_ACCESS_AUD),
);
app.route("/intake", intake);

// The old system's Studio jobs save here, each naming itself and the partner it works for.
app.use(
	"/jobs/*",
	accessDoor("jobs", (env) => env.JOBS_ACCESS_AUD),
	jobStamp,
);
app.route("/jobs", nextDeals);
app.route("/jobs", nextSteps);
app.route("/jobs", attachmentFiles);
app.route("/jobs", attachments);
app.route("/jobs", replyJobs);

export default app;
