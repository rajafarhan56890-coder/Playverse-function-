/**
 * ONE-TIME LOCAL SCRIPT — creates the very first PlayVerse admin.
 *
 * Why this exists as a standalone script instead of a callable function:
 * every other way of granting admin access requires an existing admin to
 * call it. The first admin has no such caller, so it's bootstrapped
 * locally with a Firebase service account key that never gets deployed
 * or exposed to any client.
 *
 * Usage:
 *   1. Firebase Console > Project Settings > Service Accounts >
 *      "Generate new private key" — save as serviceAccountKey.json in
 *      this scripts/ folder (already gitignored — NEVER commit this file).
 *   2. The target user must already have registered a normal PlayVerse
 *      account (email/password) via the app or Firebase Console.
 *   3. Run: npx ts-node scripts/bootstrapFirstAdmin.ts admin@example.com
 */
import * as admin from "firebase-admin";
import * as serviceAccount from "./serviceAccountKey.json";

const targetEmail = process.argv[2];
if (!targetEmail) {
  console.error("Usage: ts-node bootstrapFirstAdmin.ts <email>");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

async function main() {
  const user = await admin.auth().getUserByEmail(targetEmail);

  await admin.auth().setCustomUserClaims(user.uid, { admin: true });

  await admin.firestore().collection("admins").doc(user.uid).set({
    uid: user.uid,
    name: user.displayName ?? "",
    email: user.email,
    role: "super_admin",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✅ ${targetEmail} is now a super_admin.`);
  console.log("They must log out and back in for the claim to take effect.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
