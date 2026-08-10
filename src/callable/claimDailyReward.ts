import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { assertSignedIn } from "../lib/assertAuth";
import { creditWallet, todayUTC } from "../lib/walletTransaction";

/**
 * Credits the daily check-in reward. The amount comes from
 * `settings/global.dailyRewardAmount` — never trusts a client-sent value.
 *
 * Duplicate prevention: uses a deterministic transaction ID
 * (`daily_reward_{uid}_{utcDate}`) so at most one daily_reward transaction
 * can ever exist per user per UTC calendar day — enforced atomically by
 * creditWallet, not by a separate check that could race.
 */
export const claimDailyReward = onCall(async (request) => {
  const uid = assertSignedIn(request);

  const db = getFirestore();
  const settingsSnap = await db.collection("settings").doc("global").get();
  const dailyRewardAmount = settingsSnap.data()?.dailyRewardAmount;

  if (!dailyRewardAmount || dailyRewardAmount <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Daily rewards are not configured yet. Please try again later."
    );
  }

  const transactionId = `daily_reward_${uid}_${todayUTC()}`;

  const result = await creditWallet({
    uid,
    amount: dailyRewardAmount,
    type: "daily_reward",
    sourceId: null,
    description: "Daily check-in reward",
    transactionId,
  });

  return { success: true, amountCredited: dailyRewardAmount, newBalance: result.balanceAfter };
});
