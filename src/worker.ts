import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { activityDealAttribution } from "./activity/deal-attribution.ts";
import { dealNoteDoor } from "./activity/deal-note.ts";
import { emailSummary } from "./activity/email-summary.ts";
import { filedEmails } from "./activity/filed-emails.ts";
import { activityDoor } from "./activity/next-record.ts";
import { activity } from "./activity/routes.ts";
import { attachmentFiles, attachments, dealDocuments } from "./attachments.ts";
import { cadence } from "./cadence.ts";
import { calendarDismissal, nextAgenda } from "./calendar/next-agenda.ts";
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
import { callContextJobs, dealCallContext } from "./deals/call-context.ts";
import { dealCallOutcomes } from "./deals/call-outcomes.ts";
import { clientLeases } from "./deals/client-leases.ts";
import { dealClientWebsite } from "./deals/client-website.ts";
import { openClientWebsite } from "./deals/client-website-access.ts";
import { criticalDates } from "./deals/critical-dates.ts";
import { nationalAccounts } from "./deals/national-accounts.ts";
import {
	automaticPhaseUndo,
	dealJobs,
	nextDeals,
} from "./deals/next-change.ts";
import { notificationReads } from "./deals/notification-reads.ts";
import { dealParticipants } from "./deals/participants.ts";
import { deals } from "./deals/routes.ts";
import { dealTours } from "./deals/tours.ts";
import { docRoutes } from "./doc.ts";
import {
	claimDocLink,
	completeDocLink,
	docLinkRoutes,
} from "./doc-link-routes.ts";
import { docMcp } from "./doc-mcp.ts";
import { heldStepReviews } from "./held-steps.ts";
import { homeInbox } from "./home-inbox.ts";
import { homeMarks } from "./home-marks.ts";
import { homeToday } from "./home-today.ts";
import { invoiceJobs, invoiceUndo } from "./invoice-application.ts";
import { invoiceEvidence } from "./invoice-evidence.ts";
import { invoicePayment } from "./invoice-payment.ts";
import { invoices } from "./invoices.ts";
import { leadChanges } from "./leads/changes.ts";
import { leadEmailIntake } from "./leads/email-intake.ts";
import { leads } from "./leads/routes.ts";
import { leadSourceSenders } from "./leads/source-senders.ts";
import { mondayReviewMarks } from "./monday-review/marks.ts";
import { mondayReviewReads } from "./monday-review/read.ts";
import { jobStamp, type NextSaveEnv, userStamp } from "./next-door.ts";
import { nextStep } from "./next-step.ts";
import { automaticStepUndo, nextSteps } from "./next-steps.ts";
import { partnerGoogle } from "./partner-google.ts";
import {
	type PartnerSessionEnv,
	partnerSessionStatus,
	partnerSignOut,
	requirePartnerSession,
} from "./partner-session.ts";
import { partySearch } from "./party-search.ts";
import { type IntakeEnv, intake } from "./post-intake.ts";
import { preferenceSaves, preferences } from "./preferences.ts";
import { presence } from "./presence.ts";
import { propertySearch } from "./property-search.ts";
import { proposalDecisions, proposalJobs } from "./proposals.ts";
import { prospectAdd } from "./prospects/add.ts";
import { prospectChanges } from "./prospects/changes.ts";
import { prospectReads } from "./prospects/read.ts";
import { relationships } from "./relationships/routes.ts";
import { replyDrafts, replyJobs } from "./reply-drafts.ts";
import { routerQueue } from "./router-queue.ts";
import { search } from "./search/routes.ts";
import { requireSession } from "./session.ts";
import { today } from "./today/routes.ts";
import { updateReads, updates } from "./updates.ts";
import { vendorMeetings } from "./vendors/meeting-routes.ts";
import { changes } from "./who-did-what.ts";

export type WorkerEnv = NextSaveEnv &
	PartnerSessionEnv &
	CompareEnv &
	IntakeEnv & {
		Bindings: { CF_VERSION_METADATA: { id: string; tag?: string } };
	};

let startedAt: string | undefined;

export function recordWorkerStart() {
	startedAt ??= new Date().toISOString();
}

// Routes match the raw path as the old door did, but still decode their values.
function workerRouter() {
	const router = new Hono<WorkerEnv>({
		getPath: (request) => new URL(request.url).pathname,
	});
	router.use("*", (_c, next) => {
		recordWorkerStart();
		return next();
	});
	router.notFound((c) => c.json({ error: "not_found" }, 404));
	return router;
}

const app = workerRouter();
export const partnerApp = workerRouter();

app.get("/health", (c) => {
	const { id, tag } = c.env.CF_VERSION_METADATA;
	return c.json({
		ok: true,
		version: id,
		...(tag?.trim() && { release: tag, started_at: startedAt }),
	});
});

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
	.route("/", homeInbox)
	.route("/", homeToday)
	.route("/", invoices)
	.route("/", leads)
	.route("/", nextStep)
	.route("/", presence)
	.route("/", relationships)
	.route("/", search)
	.route("/", today)
	.route("/", updates)
	.route("/", changes)
	.route("/", preferences)
	.route("/", vendorMeetings);

const partnerApi = new Hono<WorkerEnv>();
partnerApi.use("/api/engine/*", userStamp);
partnerApi.route("/api/engine", dealTours);
partnerApi.route("/api/engine", engine);
partnerApi.route("/api/engine", dealCallContext);
partnerApi.route("/api/engine", leadChanges);
partnerApi.route("/api/engine", partySearch);
partnerApi.route("/api/engine", propertySearch);
partnerApi.route("/api/engine", clientLeases);
partnerApi.route("/api/engine", prospectReads);
partnerApi.route("/api/engine", prospectChanges);
partnerApi.route("/api/engine", nextDeals);
partnerApi.route("/api/engine", automaticPhaseUndo);
partnerApi.route("/api/engine", nationalAccounts);
partnerApi.route("/api/engine", dealParticipants);
partnerApi.route("/api/engine", dealClientWebsite);
partnerApi.route("/api/engine", openClientWebsite);
partnerApi.route("/api/engine", criticalDates);
partnerApi.route("/api/engine", nextSteps);
partnerApi.route("/api/engine", heldStepReviews);
partnerApi.route("/api/engine", homeMarks);
partnerApi.route("/api/engine", mondayReviewReads);
partnerApi.route("/api/engine", mondayReviewMarks);
partnerApi.route("/api/engine", automaticStepUndo);
partnerApi.route("/api/engine", invoiceUndo);
partnerApi.route("/api/engine", invoicePayment);
partnerApi.route("/api/engine", proposalDecisions);
partnerApi.route("/api/engine", nextAgenda);
partnerApi.route("/api/engine", calendarDismissal);
partnerApi.route("/api/engine", activityDoor);
partnerApi.route("/api/engine", prospectAdd);
partnerApi.route("/api/engine", attachmentFiles);
partnerApi.route("/api/engine", dealDocuments);
partnerApi.route("/api/engine", replyDrafts);
partnerApi.route("/api/engine", updateReads);
partnerApi.route("/api/engine", preferenceSaves);

app.post("/api/engine/doc/link/claim", claimDocLink);
const docLinkBodyLimit = bodyLimit({
	maxSize: 64 * 1024,
	onError: (c) => c.body(null, 413, { "Cache-Control": "no-store" }),
});
app.post("/api/engine/doc/link/result", docLinkBodyLimit, completeDocLink);
app.all("/api/engine/doc/mcp", docLinkBodyLimit, docMcp);
app.use("/api/engine/*", requireSession);
app.route("/", partnerApi);
partnerApp.route("/", partnerGoogle);
partnerApp.get("/auth/session", requirePartnerSession, partnerSessionStatus);
partnerApp.post("/auth/signout", requirePartnerSession, partnerSignOut);
partnerApp.use("/api/engine/*", requirePartnerSession);
partnerApp.route("/api/engine", activityDealAttribution);
partnerApp.route("/api/engine", dealCallOutcomes);
partnerApp.route("/", partnerApi);
partnerApp.route("/api/engine/doc", docRoutes());
partnerApp.route("/api/engine/doc", docLinkRoutes);

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
app.route("/jobs", cadence);
app.route("/jobs", nextDeals);
app.route("/jobs", notificationReads);
app.route("/jobs", dealJobs);
app.route("/jobs", callContextJobs);
app.route("/jobs", invoiceJobs);
app.route("/jobs", nextSteps);
app.route("/jobs", proposalJobs);
app.route("/jobs", leadEmailIntake);
app.route("/jobs", leadSourceSenders);
app.route("/jobs", routerQueue);
app.route("/jobs", nextAgenda);
app.route("/jobs", activityDoor);
app.route("/jobs", emailSummary);
app.route("/jobs", dealNoteDoor);
app.route("/jobs", filedEmails);
app.route("/jobs", attachmentFiles);
app.route("/jobs", attachments);
app.route("/jobs", replyJobs);
app.route("/jobs", invoiceEvidence);

export default app;
