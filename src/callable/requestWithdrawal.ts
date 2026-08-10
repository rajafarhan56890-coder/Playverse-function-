import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { assertSignedIn } from "../lib/assertAuth";

interface RequestWithdrawalData {
  amount: number;
  payoutMethod: "easypaisa" | "jazzcash";
  accountNumber: string;
  accountName: string;
}

const PAKISTANI_MOBILE_ACCOUNT_REGEX = /^0?3\d{9}$/; // e.g. 03001234567 or 3001234567

/**
 * Submits a withdrawal request. Validates amount against
 * `settings/global` min/max, confirms sufficient spendable balance, and
 * atomically moves the requested coins from `coins` into
 * `pendingWithdrawal` — so the same coins can never be spent on a game,
 * task, or a second withdrawal while this one is pending. The wallet's
 * total balance (coins + pendingWithdrawal) is unchanged by this step;
 * only admin approval (Phase 6) permanently removes the coins, and
 * rejection releases the hold back to `coins`.
 *
 * Duplicate prevention: a user may have at most ONE pending withdrawal
 * at a time, checked atomically inside the same transaction that creates
 * the hold — not a separate racy pre-check.
 */
export const requestWithdrawal = onCall<RequestWithdrawalData>(async (request) => {
  const uid = assertSignedIn(request);
  const { amount, payoutMethod, accountNumber, accountName } = request.data ?? {};

  // --- Validate every field before touching the database ---
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("invalid-argument", "Enter a valid withdrawal amount.");
  }
  if (payoutMethod !== "easypaisa" && payoutMethod !== "jazzcash") {
    throw new HttpsError("invalid-argument", "Select a valid payment method.");
  }
  if (!accountName || typeof accountName !== "string" || !accountName.trim()) {
    throw new HttpsError("invalid-argument", "Account holder name is required.");
  }
  if (accountName.trim().length < 2 || accountName.trim().length > 100) {
    throw new HttpsError("invalid-argument", "Enter a valid account holder name.");
  }
  if (!accountNumber || typeof accountNumber !== "string") {
    throw new HttpsError("invalid-argument", "Account number is required.");
  }
  const cleanAccountNumber = accountNumber.trim().replace(/[\s-]/g, "");
  if (!PAKISTANI_MOBILE_ACCOUNT_REGEX.test(cleanAccountNumber)) {
    throw new HttpsError(
      "invalid-argument",
      "Enter a valid mobile account number (e.g. 03001234567)."
    );
  }

  const db = getFirestore();
  const settingsSnap = await db.collection("settings").doc("global").get();
  const settings = settingsSnap.data();
  const minWithdrawalAmount = settings?.minWithdrawalAmount;
  const maxWithdrawalAmount = settings?.maxWithdrawalAmount;

  if (!minWithdrawalAmount || !maxWithdrawalAmount) {
    throw new HttpsError(
      "failed-precondition",
      "Withdrawals are not configured yet. Please try again later."
    );
  }
  if (amount < minWithdrawalAmount) {
    throw new HttpsError(
      "invalid-argument",
      `Minimum withdrawal is ${minWithdrawalAmount.toLocaleString()} coins.`
    );
  }
  if (amount > maxWithdrawalAmount) {
    throw new HttpsError(
      "invalid-argument",
      `Maximum withdrawal is ${maxWithdrawalAmount.toLocaleString()} coins.`
    );
  }

  // Prevent duplicate submissions: reject up front if a pending request
  // already exists. This is a fast, friendly pre-check; the authoritative
  // guarantee is the atomic wallet hold below, which is what actually
  // stops the money from being double-committed even under a race.
  const existingPending = await db
    .collection("withdrawals")
    .where("uid", "==", uid)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!existingPending.empty) {
    throw new HttpsError(
      "already-exists",
      "You already have a pending withdrawal request. Please wait for it to be resolved."
    );
  }

  const walletRef = db.collection("wallets").doc(uid);
  const withdrawalRef = db.collection("withdrawals").doc();

  await db.runTransaction(async (t) => {
    const walletSnap = await t.get(walletRef);
    if (!walletSnap.exists) {
      throw new HttpsError("not-found", "Wallet not found.");
    }
    const wallet = walletSnap.data()!;
    const coins = wallet.coins ?? 0;

    if (coins < amount) {
      throw new HttpsError(
        "failed-precondition",
        "Insufficient balance for this withdrawal."
      );
    }

    // Re-check for a pending withdrawal INSIDE the transaction too — closes
    // the tiny race window between the pre-check above and this write.
    const pendingCheck = await db
      .collection("withdrawals")
      .where("uid", "==", uid)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!pendingCheck.empty) {
      throw new HttpsError(
        "already-exists",
        "You already have a pending withdrawal request."
      );
    }

    t.update(walletRef, {
      coins: coins - amount,
      pendingWithdrawal: FieldValue.increment(amount),
      updatedAt: FieldValue.serverTimestamp(),
    });

    t.set(withdrawalRef, {
      id: withdrawalRef.id,
      uid,
      amount,
      payoutMethod,
      accountNumber: cleanAccountNumber,
      accountName: accountName.trim(),
      status: "pending",
      requestedAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
      rejectionReason: null,
    });

    const txRef = db.collection("transactions").doc();
    t.set(txRef, {
      id: txRef.id,
      uid,
      type: "withdrawal_hold",
      amount: -amount,
      balanceBefore: coins,
      balanceAfter: coins - amount,
      status: "pending",
      sourceId: withdrawalRef.id,
      description: `Withdrawal requested via ${payoutMethod === "easypaisa" ? "EasyPaisa" : "JazzCash"}`,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "system",
    });
  });

  return { success: true, withdrawalId: withdrawalRef.id };
});
