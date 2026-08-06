import * as functions from "firebase-functions";
import { db } from "../lib/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";

interface CompleteLevelRequest {
  gameId: string;
  level: number;
  timeSpent?: number; // Optional: time spent in seconds
}

interface CompleteLevelResponse {
  success: boolean;
  amountCredited: number;
  message: string;
}

/**
 * Cloud Function: Complete a game level and claim coins
 * - Validates user authentication
 * - Checks if level is already completed (prevent double rewards)
 * - Credits coins to wallet
 * - Records transaction
 * - Updates game progress
 */
export const completeLevelAndClaimCoins = functions.https.onCall(
  async (data: CompleteLevelRequest, context): Promise<CompleteLevelResponse> => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }

    const uid = context.auth.uid;
    const { gameId, level, timeSpent = 0 } = data;

    // Validation
    if (!gameId || typeof gameId !== "string") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "gameId is required and must be a string"
      );
    }

    if (!level || typeof level !== "number" || level < 1 || level > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "level must be a number between 1 and 100"
      );
    }

    try {
      // Get game details
      const gameDoc = await db.collection("games").doc(gameId).get();
      if (!gameDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Game not found");
      }

      const game = gameDoc.data();
      if (!game || game.status !== "active") {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Game is not active"
        );
      }

      // Get game task (assuming first task)
      const gameTask = game.tasks?.[0];
      if (!gameTask) {
        throw new functions.https.HttpsError(
          "not-found",
          "Game task not found"
        );
      }

      // Get level reward
      const levelData = gameTask.levels?.find(
        (l: { level: number }) => l.level === level
      );
      if (!levelData) {
        throw new functions.https.HttpsError(
          "not-found",
          "Level not found in game"
        );
      }

      // Get user game progress
      const progressRef = db.collection(`users/${uid}/gameProgress`).doc(gameId);
      const progressDoc = await progressRef.get();
      
      const currentProgress = progressDoc.data() || {
        uid,
        gameId,
        completedLevels: [],
        totalCoinsEarned: 0,
        lastPlayedAt: new Date(),
        createdAt: new Date(),
      };

      // Check if level already completed
      if (currentProgress.completedLevels?.includes(level)) {
        throw new functions.https.HttpsError(
          "already-exists",
          "Level already completed. Rewards already claimed."
        );
      }

      // Get global settings for multipliers
      const settingsDoc = await db.collection("settings").doc("global").get();
      const settings = settingsDoc.data() || {};
      const gameRewardMultiplier = settings.gameRewardMultiplier || 1.0;

      // Calculate coins with multiplier
      let coinsToCredit = Math.floor(
        levelData.coinsReward * gameRewardMultiplier
      );

      // Apply time-based bonus (optional)
      if (timeSpent && timeSpent < levelData.requiredScore * 0.5) {
        coinsToCredit = Math.floor(coinsToCredit * 1.25); // 25% bonus for quick completion
      }

      // Get current wallet
      const walletDoc = await db.collection("wallets").doc(uid).get();
      const wallet = walletDoc.data() || { coins: 0, totalEarned: 0 };

      const balanceBefore = wallet.coins || 0;
      const balanceAfter = balanceBefore + coinsToCredit;

      // Update wallet in transaction
      const batch = db.batch();

      // Update wallet
      batch.update(db.collection("wallets").doc(uid), {
        coins: balanceAfter,
        totalEarned: (wallet.totalEarned || 0) + coinsToCredit,
        updatedAt: new Date(),
      });

      // Update game progress
      batch.set(
        progressRef,
        {
          uid,
          gameId,
          completedLevels: [
            ...(currentProgress.completedLevels || []),
            level,
          ],
          totalCoinsEarned:
            (currentProgress.totalCoinsEarned || 0) + coinsToCredit,
          lastPlayedAt: new Date(),
          createdAt: currentProgress.createdAt || new Date(),
        },
        { merge: true }
      );

      // Record transaction
      batch.add(db.collection(`users/${uid}/transactions`), {
        type: "game_reward",
        amount: coinsToCredit,
        balanceBefore,
        balanceAfter,
        status: "completed",
        sourceId: `${gameId}-level-${level}`,
        description: `Completed Level ${level} in ${game.name}`,
        createdAt: new Date(),
        createdBy: "system",
      });

      // Commit batch
      await batch.commit();

      return {
        success: true,
        amountCredited: coinsToCredit,
        message: `Congratulations! You earned ${coinsToCredit} coins for completing Level ${level}!`,
      };
    } catch (error: any) {
      console.error("Error completing level:", error);

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError(
        "internal",
        "Failed to complete level and claim coins"
      );
    }
  }
);
