import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { assertSignedIn } from "../lib/assertAuth";
import { creditWallet } from "../lib/walletTransaction";

interface CompleteLevelData {
  gameId: string;
  level: number;
}

/**
 * Credits the reward for completing one level of an in-app level-based
 * game (Flappy Birds / Coin Clicker / Color Match). Level count and the
 * per-level coin reward are read from the `games` doc server-side — the
 * client only ever sends gameId + level number, never an amount.
 *
 * Duplicate prevention: deterministic transaction ID
 * (`game_level_{uid}_{gameId}_L{level}`) limits each user to one reward
 * per level ever, enforced atomically inside creditWallet — the same
 * pattern used by completeGame.ts.
 *
 * After the wallet credit succeeds, `users/{uid}/gameProgress/{gameId}`
 * is updated to record the level as completed (used by GameTaskScreen to
 * show progress and unlock the next level).
 */
export const completeLevelAndClaimCoins = onCall<CompleteLevelData>(async (request) => {
  const uid = assertSignedIn(request);
  const { gameId, level } = request.data;

  if (!gameId || typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "gameId is required.");
  }
  if (!level || typeof level !== "number" || !Number.isInteger(level) || level < 1) {
    throw new HttpsError("invalid-argument", "level must be a positive whole number.");
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
  if (typeof game.totalLevels !== "number" || typeof game.coinsPerLevel !== "number") {
    throw new HttpsError("failed-precondition", "This game has no valid level configuration.");
  }
  if (level > game.totalLevels) {
    throw new HttpsError("invalid-argument", `This game only has ${game.totalLevels} levels.`);
  }

  // Levels must be completed in order — block skipping ahead.
  const progressRef = db.collection("users").doc(uid).collection("gameProgress").doc(gameId);
  const progressSnap = await progressRef.get();
  const completedLevels: number[] = progressSnap.exists()
    ? progressSnap.data()!.completedLevels ?? []
    : [];

  if (completedLevels.includes(level)) {
    throw new HttpsError("already-exists", "This level has already been completed.");
  }
  if (level > 1 && !completedLevels.includes(level - 1)) {
    throw new HttpsError("failed-precondition", "Complete the previous level first.");
  }

  const reward = level * game.coinsPerLevel;
  const transactionId = `game_level_${uid}_${gameId}_L${level}`;

  const result = await creditWallet({
    uid,
    amount: reward,
    type: "game_reward",
    sourceId: gameId,
    description: `Completed ${game.name} — Level ${level}`,
    transactionId,
  });

  await progressRef.set(
    {
      gameId,
      completedLevels: FieldValue.arrayUnion(level),
      lastCompletedLevel: level,
      totalCoinsEarned: FieldValue.increment(reward),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db
    .collection("games")
    .doc(gameId)
    .update({ playCount: FieldValue.increment(1) });

  return {
    success: true,
    amountCredited: reward,
    newBalance: result.balanceAfter,
  };
});
