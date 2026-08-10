import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { assertIsAdmin } from "../lib/assertAuth";

interface AdminRejectWithdrawalData {
  withdrawalId: string;
  reason: string;
}

/**
 * Admin-only: rejects a pending withdrawal and releases the held coins
 * back to the user's spendable balance. A rejection reason is required
 * so the user (and any future support conversation) has a clear record
 * of why.
 */
export const adminRejectWithdrawal = onCall<AdminRejectWithdrawalData>(async (request) => {
  const adminUid = assertIsAdmin(request);
  const { withdrawalId, reason } = request.data ?? {};

  if (!withdrawalId || typeof withdrawalId !== "string") {
    throw new HttpsError("invalid-argument", "withdrawalId is required.");
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    throw new HttpsError("invalid-argument", "A rejection reason is required.");
  }

  const db = getFirestore();
  const withdrawalRef = db.collection("withdrawals").doc(withdrawalId);

  await db.runTransaction(async (t) => {
    const withdrawalSnap = await t.get(withdrawalRef);
    if (!withdrawalSnap.exists) {
      throw new HttpsError("not-found", "Withdrawal request not found.");
    }
    const withdrawal = withdrawalSnap.data()!;

    if (withdrawal.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        `This request has already been ${withdrawal.status}.`
      );
    }

    const walletRef = db.collection("wallets").doc(withdrawal.uid);
    const walletSnap = await t.get(walletRef);
    if (!walletSnap.exists) {
      throw new HttpsError("not-found", "Wallet not found for this user.");
    }
    const wallet = walletSnap.data()!;
    const pendingBefore = wallet.pendingWithdrawal ?? 0;
    const coinsBefore = wallet.coins ?? 0;

    if (pendingBefore < withdrawal.amount) {
      throw new HttpsError(
        "failed-precondition",
        "Wallet's held balance is inconsistent with this request. Investigate before rejecting."
      );
    }

    const coinsAfter = coinsBefore + withdrawal.amount;

    t.update(walletRef, {
      coins: coinsAfter,
      pendingWithdrawal: pendingBefore - withdrawal.amount,
      updatedAt: FieldValue.serverTimestamp(),
    });

    t.update(withdrawalRef, {
      status: "rejected",
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: adminUid,
      rejectionReason: reason.trim(),
    });

    const txRef = db.collection("transactions").doc();
    t.set(txRef, {
      id: txRef.id,
      uid: withdrawal.uid,
      type: "withdrawal_rejected",
      amount: withdrawal.amount,
      balanceBefore: coinsBefore,
      balanceAfter: coinsAfter,
      status: "completed",
      sourceId: withdrawalId,
      description: `Withdrawal rejected: ${reason.trim()}`,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "admin",
    });
  });

  return { success: true };
});
