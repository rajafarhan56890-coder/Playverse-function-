import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { assertIsAdmin } from "../lib/assertAuth";

interface AdminAdjustBalanceData {
  uid: string;
  amount: number; // positive to credit, negative to debit
  reason: string;
}

/**
 * Admin-only: free-form wallet correction, positive or negative — e.g.
 * fixing a support ticket, reversing an exploit, or a manual top-up that
 * doesn't fit any of the specific reward types. Distinct from
 * `grantBonusReward` (Phase 3), which is always positive and framed as a
 * reward, not a correction.
 *
 * A non-empty reason is required on every adjustment, and every
 * adjustment writes a `transactions` ledger entry with `createdBy:
 * "admin"` — there is no way to move coins through this function
 * without leaving an auditable record of who did it and why.
 *
 * A negative adjustment can never push the wallet below zero, same hard
 * floor as every other debit path in the system.
 */
export const adminAdjustBalance = onCall<AdminAdjustBalanceData>(async (request) => {
  const adminUid = assertIsAdmin(request);
  const { uid, amount, reason } = request.data ?? {};

  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
    throw new HttpsError("invalid-argument", "amount must be a non-zero number.");
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    throw new HttpsError("invalid-argument", "A reason is required for every balance adjustment.");
  }

  const db = getFirestore();
  const walletRef = db.collection("wallets").doc(uid);

  const result = await db.runTransaction(async (t) => {
    const walletSnap = await t.get(walletRef);
    if (!walletSnap.exists) {
      throw new HttpsError("not-found", "Wallet not found for this user.");
    }
    const wallet = walletSnap.data()!;
    const balanceBefore = wallet.coins ?? 0;
    const balanceAfter = balanceBefore + amount;

    if (balanceAfter < 0) {
      throw new HttpsError(
        "failed-precondition",
        "This adjustment would take the wallet below zero."
      );
    }

    const updates: Record<string, unknown> = {
      coins: balanceAfter,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Only positive adjustments count toward lifetime earnings (leaderboard,
    // level) — a negative correction shouldn't retroactively lower a user's
    // "total earned" history, since it may be correcting something unrelated
    // to how they originally earned it.
    if (amount > 0) {
      updates.totalEarned = FieldValue.increment(amount);
    }
    t.update(walletRef, updates);

    const txRef = db.collection("transactions").doc();
    t.set(txRef, {
      id: txRef.id,
      uid,
      type: "admin_adjustment",
      amount,
      balanceBefore,
      balanceAfter,
      status: "completed",
      sourceId: adminUid,
      description: reason.trim(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "admin",
    });

    return balanceAfter;
  });

  return { success: true, newBalance: result };
});
