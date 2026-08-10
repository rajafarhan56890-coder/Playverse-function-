import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { assertIsAdmin } from "../lib/assertAuth";
import type { AdminUser } from "../types/models";

interface AddAdminData {
  email: string;
  role?: "super_admin" | "admin";
}

/**
 * Grants a user admin access: sets the `admin: true` custom claim (the
 * single source of truth checked by both firestore.rules and every other
 * callable function) AND writes an /admins doc for auditing/display in
 * the dashboard's team list.
 *
 * SECURITY: only a caller who is ALREADY a super_admin may call this.
 * This deliberately means the very first admin cannot be created through
 * the app — it must be bootstrapped once via a local script using a
 * service account key (see setup guide, "Seed the first admin"). That
 * bootstrap step is intentionally kept out of any deployed, publicly
 * reachable function.
 */
export const addAdmin = onCall<AddAdminData>(async (request) => {
  const callerUid = assertIsAdmin(request);

  const db = getFirestore();
  const callerDoc = await db.collection("admins").doc(callerUid).get();
  if (callerDoc.data()?.role !== "super_admin") {
    throw new HttpsError(
      "permission-denied",
      "Only a super admin can grant admin access."
    );
  }

  const { email, role = "admin" } = request.data;
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "A valid email is required.");
  }

  let targetUser;
  try {
    targetUser = await getAuth().getUserByEmail(email.trim());
  } catch {
    throw new HttpsError(
      "not-found",
      "No PlayVerse account exists with that email. Ask them to register first."
    );
  }

  await getAuth().setCustomUserClaims(targetUser.uid, { admin: true });

  const adminDoc: AdminUser = {
    uid: targetUser.uid,
    name: targetUser.displayName ?? "",
    email: targetUser.email ?? email,
    role,
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection("admins").doc(targetUser.uid).set(adminDoc);

  return { success: true, uid: targetUser.uid };
});
