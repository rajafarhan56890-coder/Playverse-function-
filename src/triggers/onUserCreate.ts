import { auth } from "firebase-functions/v1";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { generateUniqueReferralCode } from "../lib/referralCode";
import type { UserProfile, Wallet } from "../types/models";

/**
 * Fires automatically whenever a new Firebase Auth account is created —
 * for BOTH the email/password registration flow in the app. This is the
 * single, server-controlled place a `users` doc and its `wallets` doc are
 * ever created. The client cannot create either doc itself (see
 * firestore.rules: `allow create: if false` on /users and /wallets),
 * which is what guarantees every account starts at exactly 0 coins with
 * no way to inject a fake starting balance.
 *
 * Using firebase-functions v1 `auth.user().onCreate` here deliberately —
 * as of this writing it remains the supported way to trigger on Auth
 * account creation; v2 equivalents can be substituted once stable.
 */
export const onUserCreate = auth.user().onCreate(async (user) => {
  const db = getFirestore();
  const referralCode = await generateUniqueReferralCode();

  const profile: UserProfile = {
    uid: user.uid,
    name: user.displayName ?? "",
    email: user.email ?? "",
    phone: user.phoneNumber ?? null,
    photoURL: user.photoURL ?? null,
    referralCode,
    referredBy: null,
    level: 1,
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    lastLoginAt: FieldValue.serverTimestamp(),
  };

  const wallet: Wallet = {
    uid: user.uid,
    coins: 0,
    pendingWithdrawal: 0,
    totalEarned: 0,
    totalWithdrawn: 0,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(db.collection("users").doc(user.uid), profile);
  batch.set(db.collection("wallets").doc(user.uid), wallet);
  await batch.commit();
});
