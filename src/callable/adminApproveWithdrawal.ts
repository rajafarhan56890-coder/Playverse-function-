import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { assertIsAdmin } from "../lib/assertAuth";

interface AdminApproveWithdrawalData {
  withdrawalId: string;
}

/**
 * Admin-only: approves a pending withdrawal. Permanently deducts the
 * held coins from `pendingWithdrawal` (they were already removed from
 * spendable `coins` when the request was made) and bumps
 * `totalWithdrawn`. This is the ONLY place `pendingWithdrawal` decreases
 * without the coins coming back — i.e. the only place money actually
 * leaves the platform.
 */
export const adminApproveWithdrawal = onCall<AdminApproveWithdrawalData>(async (request) => {
  const adminUid = assertIsAdmin(request);
  const { withdrawalId } = request.data ?? {};

  if (!withdrawalId || typeof withdrawalId !== "string") {
    throw new HttpsError("invalid-argument", "withdrawalId is required.");
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

    if (pendingBefore < withdrawal.amount) {
      // Should never happen given the request flow, but never let the
      // held amount go negative under any circumstance.
      throw new HttpsError(
        "failed-precondition",
        "Wallet's held balance is inconsistent with this request. Investigate before approving."
      );
    }

    t.update(walletRef, {
      pendingWithdrawal: pendingBefore - withdrawal.amount,
      totalWithdrawn: FieldValue.increment(withdrawal.amount),
      updatedAt: FieldValue.serverTimestamp(),
    });

    t.update(withdrawalRef, {
      status: "approved",
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: adminUid,
    });

    const txRef = db.collection("transactions").doc();
    t.set(txRef, {
      id: txRef.id,
      uid: withdrawal.uid,
      type: "withdrawal_approved",
      amount: 0, // coins already left `coins` at request time; this entry marks resolution, not a new balance change
      balanceBefore: wallet.coins ?? 0,
      balanceAfter: wallet.coins ?? 0,
      status: "completed",
      sourceId: withdrawalId,
      description: "Withdrawal approved and processed",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "admin",
    });
  });

  return { success: true };
});
