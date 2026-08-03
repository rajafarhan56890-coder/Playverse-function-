import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { TransactionType, TransactionStatus } from "../types/models";

interface CreditParams {
  uid: string;
  amount: number; // always positive for a credit
  type: TransactionType;
  sourceId?: string | null;
  description: string;
  createdBy?: "system" | "admin";
  /**
   * Deterministic transaction doc ID (e.g. `daily_reward_{uid}_{date}`).
   * When provided, this doubles as the duplicate-prevention key: the same
   * reward can never be credited twice, because the second attempt's
   * transaction doc write collides with the first inside the SAME
   * Firestore transaction, and Firestore's transaction isolation
   * guarantees only one caller ever wins that race — no separate
   * "check then act" query is needed, which closes the tiny race window
   * a query-based check would leave open. Omit only for credits that are
   * inherently one-off and don't need dedup (e.g. an admin bonus with no
   * natural repeat key).
   */
  transactionId?: string;
  status?: TransactionStatus;
}

interface WalletMutationResult {
  balanceBefore: number;
  balanceAfter: number;
  transactionId: string;
}

/**
 * Credits coins to a user's wallet inside a Firestore transaction and
 * writes a matching immutable ledger entry with the FULL required field
 * set: id, uid, type, amount, balanceBefore, balanceAfter, status,
 * description, createdAt, createdBy. This is the ONLY function in the
 * whole backend that should ever increment `wallets.coins` — every
 * reward path (daily check-in, game, task/offer, referral, bonus) and
 * every future withdrawal-refund path routes through here so the wallet
 * balance and the transaction ledger can never drift apart.
 */
export async function creditWallet(params: CreditParams): Promise<WalletMutationResult> {
  const {
    uid,
    amount,
    type,
    sourceId = null,
    description,
    createdBy = "system",
    transactionId,
    status = "completed",
  } = params;

  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "A valid uid is required.");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("invalid-argument", "Credit amount must be a positive number.");
  }
  if (!description || typeof description !== "string" || !description.trim()) {
    throw new HttpsError("invalid-argument", "A description is required for every transaction.");
  }

  const db = getFirestore();
  const walletRef = db.collection("wallets").doc(uid);
  const txRef = transactionId
    ? db.collection("transactions").doc(transactionId)
    : db.collection("transactions").doc();

  return db.runTransaction(async (t) => {
    // Both reads happen before any writes — required by Firestore transactions,
    // and this is also what makes the dedup check atomic with the balance update.
    const [walletSnap, existingTxSnap] = await Promise.all([
      t.get(walletRef),
      t.get(txRef),
    ]);

    if (!walletSnap.exists) {
      throw new HttpsError("not-found", "Wallet not found for this user.");
    }
    if (existingTxSnap.exists) {
      throw new HttpsError("already-exists", "This reward has already been claimed.");
    }

    const wallet = walletSnap.data()!;
    const balanceBefore = wallet.coins ?? 0;
    const balanceAfter = balanceBefore + amount;

    t.update(walletRef, {
      coins: balanceAfter,
      totalEarned: FieldValue.increment(amount),
      updatedAt: FieldValue.serverTimestamp(),
    });

    t.set(txRef, {
      id: txRef.id,
      uid,
      type,
      amount,
      balanceBefore,
      balanceAfter,
      status,
      sourceId,
      description: description.trim(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy,
    });

    return { balanceBefore, balanceAfter, transactionId: txRef.id };
  });
}

/** Builds a UTC calendar-day string (e.g. "2026-08-02") used in deterministic daily-reward IDs. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Builds an ISO 8601 week string (e.g. "2026-W31") used in deterministic
 * weekly-task IDs, so a weekly task resets every Monday (UTC) rather than
 * every rolling 7 days from the user's first claim.
 */
export function weekUTC(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO week date: Thursday of the current week determines the week-year.
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
