import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { db } from "../config";

interface GameSettings {
  coinToCurrencyRate?: number;
  minWithdrawalAmount?: number;
  maxWithdrawalAmount?: number;
  dailyRewardAmount?: number;
  referralBonusReferrer?: number;
  referralBonusReferred?: number;
  referralTier2Bonus?: number;
  gameRewardMultiplier?: number;
  processingFeePercent?: number;
  maxDailyWithdrawals?: number;
}

interface UpdateGameSettingsRequest {
  settings: GameSettings;
}

interface UpdateGameSettingsResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export const updateGameSettings = functions.https.onCall(
  async (
    data: UpdateGameSettingsRequest,
    context
  ): Promise<UpdateGameSettingsResponse> => {
    // Check authentication
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }

    const uid = context.auth.uid;

    try {
      // Check if user is admin
      const userSnap = await db.collection("users").doc(uid).get();
      const userData = userSnap.data();

      if (userData?.role !== "admin") {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Only admins can update settings"
        );
      }

      const { settings } = data;

      // Validate settings
      if (!settings || typeof settings !== "object") {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "settings must be an object"
        );
      }

      // Validate numeric values
      const validSettings: GameSettings = {};

      if (
        settings.coinToCurrencyRate !== undefined &&
        settings.coinToCurrencyRate > 0
      ) {
        validSettings.coinToCurrencyRate = settings.coinToCurrencyRate;
      }

      if (
        settings.minWithdrawalAmount !== undefined &&
        settings.minWithdrawalAmount > 0
      ) {
        validSettings.minWithdrawalAmount = settings.minWithdrawalAmount;
      }

      if (
        settings.maxWithdrawalAmount !== undefined &&
        settings.maxWithdrawalAmount > 0
      ) {
        validSettings.maxWithdrawalAmount = settings.maxWithdrawalAmount;
      }

      if (
        settings.dailyRewardAmount !== undefined &&
        settings.dailyRewardAmount >= 0
      ) {
        validSettings.dailyRewardAmount = settings.dailyRewardAmount;
      }

      if (
        settings.referralBonusReferrer !== undefined &&
        settings.referralBonusReferrer >= 0
      ) {
        validSettings.referralBonusReferrer = settings.referralBonusReferrer;
      }

      if (
        settings.referralBonusReferred !== undefined &&
        settings.referralBonusReferred >= 0
      ) {
        validSettings.referralBonusReferred = settings.referralBonusReferred;
      }

      if (
        settings.referralTier2Bonus !== undefined &&
        settings.referralTier2Bonus >= 0
      ) {
        validSettings.referralTier2Bonus = settings.referralTier2Bonus;
      }

      if (
        settings.gameRewardMultiplier !== undefined &&
        settings.gameRewardMultiplier > 0
      ) {
        validSettings.gameRewardMultiplier = settings.gameRewardMultiplier;
      }

      if (
        settings.processingFeePercent !== undefined &&
        settings.processingFeePercent >= 0
      ) {
        validSettings.processingFeePercent = settings.processingFeePercent;
      }

      if (
        settings.maxDailyWithdrawals !== undefined &&
        settings.maxDailyWithdrawals > 0
      ) {
        validSettings.maxDailyWithdrawals = settings.maxDailyWithdrawals;
      }

      // Update settings in Firestore
      const settingsRef = db.collection("settings").doc("global");

      await settingsRef.set(
        {
          ...validSettings,
          updatedBy: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Log admin action
      await db.collection("adminLogs").add({
        action: "UPDATE_GAME_SETTINGS",
        adminId: uid,
        changes: Object.keys(validSettings),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        message: `Updated ${Object.keys(validSettings).length} settings`,
      };
    } catch (error) {
      console.error("Error updating game settings:", error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError(
        "internal",
        "Failed to update game settings"
      );
    }
  }
);
