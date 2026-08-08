import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { db } from "../config";

interface PaymentMethod {
  id: string;
  name: string;
  enabled: boolean;
  minPayout: number;
  maxPayout: number;
  fee: number;
}

interface UpdatePaymentMethodsRequest {
  methods: PaymentMethod[];
}

interface UpdatePaymentMethodsResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export const updatePaymentMethods = functions.https.onCall(
  async (
    data: UpdatePaymentMethodsRequest,
    context
  ): Promise<UpdatePaymentMethodsResponse> => {
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
          "Only admins can update payment methods"
        );
      }

      const { methods } = data;

      // Validate methods
      if (!Array.isArray(methods)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "methods must be an array"
        );
      }

      for (const method of methods) {
        if (
          !method.id ||
          !method.name ||
          typeof method.enabled !== "boolean" ||
          method.minPayout <= 0 ||
          method.maxPayout <= 0 ||
          method.minPayout > method.maxPayout
        ) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "Invalid payment method data"
          );
        }
      }

      // Update payment methods in Firestore
      const paymentMethodsRef = db
        .collection("settings")
        .doc("paymentMethods");

      await paymentMethodsRef.set(
        {
          methods,
          updatedBy: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Log admin action
      await db.collection("adminLogs").add({
        action: "UPDATE_PAYMENT_METHODS",
        adminId: uid,
        changes: {
          methodCount: methods.length,
          enabledCount: methods.filter((m) => m.enabled).length,
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        message: `Updated ${methods.length} payment methods`,
      };
    } catch (error) {
      console.error("Error updating payment methods:", error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError(
        "internal",
        "Failed to update payment methods"
      );
    }
  }
);
