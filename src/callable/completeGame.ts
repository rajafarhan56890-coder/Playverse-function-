import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { assertSignedIn } from "../lib/assertAuth";
import { creditWallet, todayUTC } from "../lib/walletTransaction";

interface CompleteGameData {
  gameId: string;
}

/**
 * Credits the reward for completing a game. Reward amount and active
 * status are read from the `games` doc server-side — the client only ever
 * sends the gameId, never an amount.
 *
 * Duplicate prevention: deterministic transaction ID
 * (`game_reward_{uid}_{gameId}_{utcDate}`) limits each user to one reward
 * per game per UTC calendar day, enforced atomically inside creditWallet.
 */
export const completeGame = onCall<CompleteGameData>(async (request) => {
  const uid = assertSignedIn(request);
  const { gameId } = request.data;

  if (!gameId || typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "gameId is required.");
  }

  const db = getFirestore();
  const gameSnap = await db.collection("games").doc(gameId).get();

  if (!gameSnap.exists) {
    throw new HttpsError("not-found", "This game no longer exists.");
  }
  const game = gameSnap.data()!;
  if (game.status !== "active") {
    throw new HttpsError("failed-precondition", "This game is not currently active.");
  }
  if (typeof game.reward !== "number" || game.reward <= 0) {
    throw new HttpsError("failed-precondition", "This game has no valid reward configured.");
  }

  const transactionId = `game_reward_${uid}_${gameId}_${todayUTC()}`;

  const result = await creditWallet({
    uid,
    amount: game.reward,
    type: "game_reward",
    sourceId: gameId,
    description: `Completed game: ${game.name}`,
    transactionId,
  });

  await db
    .collection("games")
    .doc(gameId)
    .update({ playCount: FieldValue.increment(1) });

  return { success: true, amountCredited: game.reward, newBalance: result.balanceAfter };
});
