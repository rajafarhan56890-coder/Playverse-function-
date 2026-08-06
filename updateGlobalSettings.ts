import * as functions from "firebase-functions";
import { db } from "../lib/firebase-admin";

interface UpdateSettingsRequest {
  coinToCurrencyRate?: number;
  minWithdrawalAmount?: number;
  maxWithdrawalAmount?: number;
  dailyRewardAmount?: number;
  referralBonusReferrer?: number;
  referralBonusReferred?: number;
  referralTier2Bonus?: number;
  gameRewardMultiplier?: number;
}

interface UpdateSettingsResponse {
  success: boolean;
  data?: any;
  message?: string;
}

/**
 * Cloud Function: Update Global Settings (Admin Only)
 * - Validates admin access
 * - Updates settings in Firestore
 * - Records audit log
 * - Returns updated settings
 */
export const updateGlobalSettings = functions.https.onCall(
  async (data: UpdateSettingsRequest, context): Promise<UpdateSettingsResponse> => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }

    const uid = context.auth.uid;

    try {
      // Verify admin access
      const adminDoc = await db.collection("admins").doc(uid).get();
      if (!adminDoc.exists) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Only admins can update settings"
        );
      }

      const admin = adminDoc.data();
      if (!admin || !["super_admin", "admin"].includes(admin.role)) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Insufficient permissions"
        );
      }

      // Validate input
      const updateData: any = {};

      if (data.coinToCurrencyRate !== undefined) {
        if (typeof data.coinToCurrencyRate !== "number" || data.coinToCurrencyRate <= 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "coinToCurrencyRate must be a positive number"
          );
        }
        updateData.coinToCurrencyRate = data.coinToCurrencyRate;
      }

      if (data.minWithdrawalAmount !== undefined) {
        if (typeof data.minWithdrawalAmount !== "number" || data.minWithdrawalAmount < 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "minWithdrawalAmount must be a non-negative number"
          );
        }
        updateData.minWithdrawalAmount = data.minWithdrawalAmount;
      }

      if (data.maxWithdrawalAmount !== undefined) {
        if (typeof data.maxWithdrawalAmount !== "number" || data.maxWithdrawalAmount < 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "maxWithdrawalAmount must be a non-negative number"
          );
        }
        updateData.maxWithdrawalAmount = data.maxWithdrawalAmount;
      }

      if (data.dailyRewardAmount !== undefined) {
        if (typeof data.dailyRewardAmount !== "number" || data.dailyRewardAmount < 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "dailyRewardAmount must be a non-negative number"
          );
        }
        updateData.dailyRewardAmount = data.dailyRewardAmount;
      }

      if (data.referralBonusReferrer !== undefined) {
        if (typeof data.referralBonusReferrer !== "number" || data.referralBonusReferrer < 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "referralBonusReferrer must be a non-negative number"
          );
        }
        updateData.referralBonusReferrer = data.referralBonusReferrer;
      }

      if (data.referralBonusReferred !== undefined) {
        if (typeof data.referralBonusReferred !== "number" || data.referralBonusReferred < 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "referralBonusReferred must be a non-negative number"
          );
        }
        updateData.referralBonusReferred = data.referralBonusReferred;
      }

      if (data.referralTier2Bonus !== undefined) {
        if (typeof data.referralTier2Bonus !== "number" || data.referralTier2Bonus < 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "referralTier2Bonus must be a non-negative number"
          );
        }
        updateData.referralTier2Bonus = data.referralTier2Bonus;
      }

      if (data.gameRewardMultiplier !== undefined) {
        if (typeof data.gameRewardMultiplier !== "number" || data.gameRewardMultiplier <= 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "gameRewardMultiplier must be a positive number"
          );
        }
        updateData.gameRewardMultiplier = data.gameRewardMultiplier;
      }

      // Check min/max consistency
      if (
        updateData.minWithdrawalAmount !== undefined &&
        updateData.maxWithdrawalAmount !== undefined &&
        updateData.minWithdrawalAmount > updateData.maxWithdrawalAmount
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "minWithdrawalAmount must be less than maxWithdrawalAmount"
        );
      }

      if (Object.keys(updateData).length === 0) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "No valid settings to update"
        );
      }

      // Add timestamp
      updateData.updatedAt = new Date();

      // Update settings
      await db.collection("settings").doc("global").update(updateData);

      // Log audit trail
      await db.collection("audit_logs").add({
        type: "settings_update",
        adminUid: uid,
        adminName: admin.name,
        changes: updateData,
        timestamp: new Date(),
      });

      // Get updated settings
      const updatedDoc = await db.collection("settings").doc("global").get();
      const updatedSettings = updatedDoc.data();

      return {
        success: true,
        data: updatedSettings,
        message: "Settings updated successfully",
      };
    } catch (error: any) {
      console.error("Error updating global settings:", error);

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError(
        "internal",
        "Failed to update global settings"
      );
    }
  }
);
