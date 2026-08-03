import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { assertIsAdmin } from "../lib/assertAuth";
import { creditWallet } from "../lib/walletTransaction";

interface GrantBonusRewardData {
  uid: string;
  amount: number;
  description: string;
  /**
   * Optional client-supplied key (e.g. a UUID generated once when the
   * admin opens the "grant bonus" form). If provided, it's folded into a
   * deterministic transaction ID so an accidental double-submit (double
   * click, retried request after a timeout) can never grant the bonus
   * twice. Omit it and each call is treated as a distinct, intentional
   * bonus grant.
   */
  idempotencyKey?: string;
}

/**
 * Admin-only: grants a one-off "bonus reward" to a user — distinct from
 * `admin_adjustment` (Phase 6), which is a free-form correction that can
 * be positive or negative. A bonus reward is always a positive, ledgered
 * credit with a required human-readable description (e.g. "Community
 * contest winner", "Compensation for downtime").
 */
export const grantBonusReward = onCall<GrantBonusRewardData>(async (request) => {
  assertIsAdmin(request);

  const { uid, amount, description, idempotencyKey } = request.data ?? {};

  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "A target uid is required.");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("invalid-argument", "amount must be a positive number.");
  }
  if (!description || typeof description !== "string" || !description.trim()) {
    throw new HttpsError("invalid-argument", "A description is required for bonus rewards.");
  }

  const db = getFirestore();
  const walletSnap = await db.collection("wallets").doc(uid).get();
  if (!walletSnap.exists) {
    throw new HttpsError("not-found", "No wallet exists for this user.");
  }

  const transactionId =
    idempotencyKey && typeof idempotencyKey === "string" && idempotencyKey.trim()
      ? `bonus_reward_${uid}_${idempotencyKey.trim()}`
      : undefined;

  const result = await creditWallet({
    uid,
    amount,
    type: "bonus_reward",
    sourceId: null,
    description: description.trim(),
    createdBy: "admin",
    transactionId,
  });

  return { success: true, newBalance: result.balanceAfter };
});
