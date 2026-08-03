import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { assertIsAdmin } from "../lib/assertAuth";

interface SetUserStatusData {
  uid: string;
  status: "active" | "blocked";
}

/**
 * Admin-only: blocks or unblocks a user account. Goes through a Cloud
 * Function rather than a direct Firestore write from the admin panel
 * because `status` is explicitly excluded from client-writable fields in
 * firestore.rules (see /users/{uid} update rule) — this function uses
 * the Admin SDK, which bypasses that rule by design, and is the single
 * place that field is ever allowed to change.
 */
export const adminSetUserStatus = onCall<SetUserStatusData>(async (request) => {
  assertIsAdmin(request);
  const { uid, status } = request.data ?? {};

  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  if (status !== "active" && status !== "blocked") {
    throw new HttpsError("invalid-argument", "status must be 'active' or 'blocked'.");
  }

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  await userRef.update({ status });

  return { success: true };
});
