import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { db } from "../config";

interface CompleteGameLevelRequest {
  gameId: string;
  levelNumber: number;
}

interface CompleteGameLevelResponse {
  success: boolean;
  coinsAwarded?: number;
  totalCoins?: number;
  error?: string;
}

export const completeGameLevel = functions.https.onCall(
  async (
    data: CompleteGameLevelRequest,
    context
  ): Promise<CompleteGameLevelResponse> => {
    // Check authentication
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }

    const uid = context.auth.uid;
    const { gameId, levelNumber } = data;

    // Validate inputs
    if (!gameId || !levelNumber) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "gameId and levelNumber are required"
      );
    }

    if (levelNumber < 1 || levelNumber > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Level must be between 1 and 100"
      );
    }

    try {
      // Get global settings
      const settingsSnap = await db.collection("settings").doc("global").get();
      const settings = settingsSnap.data() || {
        gameRewardMultiplier: 1.0,
      };

      // Calculate coins for this level
      const baseCoins = levelNumber * 10;
      const coinsToAward = Math.floor(
        baseCoins * (settings.gameRewardMultiplier || 1.0)
      );

      // Get user's current game progress
      const progressRef = db
        .collection("users")
        .doc(uid)
        .collection("gameProgress")
        .doc(gameId);

      const progressSnap = await progressRef.get();
      const progressData = progressSnap.data() || {
        completedLevels: [],
        totalCoinsEarned: 0,
      };

      // Check if level already completed (prevent double reward)
      if (progressData.completedLevels.includes(levelNumber)) {
        return {
          success: false,
          error: "Level already completed",
        };
      }

      // Add level to completed list
      const updatedCompletedLevels = [
        ...progressData.completedLevels,
        levelNumber,
      ];
      updatedCompletedLevels.sort((a, b) => a - b);

      // Update game progress
      await progressRef.update({
        completedLevels: updatedCompletedLevels,
        totalCoinsEarned:
          (progressData.totalCoinsEarned || 0) + coinsToAward,
        lastCompletedLevel: levelNumber,
        lastCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Get user wallet
      const walletRef = db.collection("users").doc(uid).collection("wallet").doc("main");
      const walletSnap = await walletRef.get();
      const walletData = walletSnap.data() || {
        coins: 0,
        totalEarned: 0,
      };

      // Update wallet with new coins
      const newCoinsBalance = (walletData.coins || 0) + coinsToAward;
      const newTotalEarned = (walletData.totalEarned || 0) + coinsToAward;

      await walletRef.set(
        {
          coins: newCoinsBalance,
          totalEarned: newTotalEarned,
          lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Log transaction
      await db
        .collection("users")
        .doc(uid)
        .collection("transactions")
        .add({
          type: "game_reward",
          gameId,
          levelNumber,
          coinsAwarded: coinsToAward,
          walletBalance: newCoinsBalance,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

      return {
        success: true,
        coinsAwarded: coinsToAward,
        totalCoins: newCoinsBalance,
      };
    } catch (error) {
      console.error("Error completing game level:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to complete game level"
      );
    }
  }
);
