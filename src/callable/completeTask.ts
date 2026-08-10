import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { assertSignedIn } from "../lib/assertAuth";
import { creditWallet, todayUTC, weekUTC } from "../lib/walletTransaction";

interface CompleteTaskData {
  offerId: string;
}

/**
 * Credits the reward for completing a task/offer (the `offers` collection
 * holds both `type: "task"` and `type: "offer"` docs, so this one function
 * covers both — see 02-FIRESTORE-SCHEMA.md). Reward and status are read
 * from Firestore, never trusted from the client.
 *
 * Duplicate prevention key depends on the task's reset cadence:
 *   - taskType "daily"                        → resets every UTC day
 *   - taskType "weekly"                        → resets every UTC ISO week
 *   - taskType "special"/"social"/"app_engagement", or type "offer"  → one-time-ever
 * All variants use a deterministic transaction ID, so the guarantee is the
 * same atomic one used everywhere else in the wallet system: the second
 * concurrent claim's write collides with the first inside creditWallet's
 * Firestore transaction and is rejected, not raced.
 */
export const completeTask = onCall<CompleteTaskData>(async (request) => {
  const uid = assertSignedIn(request);
  const { offerId } = request.data;

  if (!offerId || typeof offerId !== "string") {
    throw new HttpsError("invalid-argument", "offerId is required.");
  }

  const db = getFirestore();
  const offerSnap = await db.collection("offers").doc(offerId).get();

  if (!offerSnap.exists) {
    throw new HttpsError("not-found", "This offer no longer exists.");
  }
  const offer = offerSnap.data()!;

  if (offer.status !== "active") {
    throw new HttpsError("failed-precondition", "This offer is not currently active.");
  }
  if (typeof offer.reward !== "number" || offer.reward <= 0) {
    throw new HttpsError("failed-precondition", "This offer has no valid reward configured.");
  }

  const expiresAt: Timestamp | null = offer.expiresAt ?? null;
  if (expiresAt && expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "This offer has expired.");
  }

  const taskType: string | null = offer.taskType ?? null;
  let transactionId: string;
  switch (taskType) {
    case "daily":
      transactionId = `task_reward_${uid}_${offerId}_${todayUTC()}`;
      break;
    case "weekly":
      transactionId = `task_reward_${uid}_${offerId}_${weekUTC()}`;
      break;
    default:
      // special / social / app_engagement task types, and plain "offer" docs,
      // are all one-time-ever per user.
      transactionId = `task_reward_${uid}_${offerId}`;
  }

  const label = offer.type === "offer" ? "offer" : "task";

  const result = await creditWallet({
    uid,
    amount: offer.reward,
    type: "task_reward",
    sourceId: offerId,
    description: `Completed ${label}: ${offer.title}`,
    transactionId,
  });

  await db
    .collection("offers")
    .doc(offerId)
    .update({ completionCount: FieldValue.increment(1) });

  return { success: true, amountCredited: offer.reward, newBalance: result.balanceAfter };
});
