import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { assertSignedIn } from "../lib/assertAuth";

interface ApplyReferralBonusData {
  referralCode: string;
}

/**
 * Applies a referral code: credits the referrer (tier 1) and the newly
 * referred user, marks the referred user as having used their one
 * referral via `users.referredBy`, and — if the referrer was themselves
 * referred by someone — also credits that person a smaller tier-2 bonus.
 *
 * Two-tier example: Alice refers Bob. Bob refers Carol.
 *   - Carol registers with Bob's code -> Bob gets the tier-1 bonus, Carol
 *     gets the referred-user bonus, AND Alice (Bob's referrer) gets a
 *     tier-2 bonus, because her network grew two levels deep.
 *   - Tier 2 is skipped entirely (no error, just no extra credit) if the
 *     referrer has no referrer of their own, or if
 *     `settings/global.referralTier2Bonus` is 0/unset.
 *
 * This does NOT reuse creditWallet's single-wallet transaction helper,
 * because a referral is inherently a multi-document operation (the
 * referred user's profile doc + two or three wallets + a referrals
 * record) that all need to succeed or fail together. One Firestore
 * transaction reads every document first, then writes all of them —
 * which is what makes the duplicate-prevention check safe: if two calls
 * race, Firestore's transaction isolation guarantees only one of them
 * ever observes `referredBy` as still null and commits.
 */
export const applyReferralBonus = onCall<ApplyReferralBonusData>(async (request) => {
  const uid = assertSignedIn(request);
  const rawCode = request.data?.referralCode;

  if (!rawCode || typeof rawCode !== "string" || !rawCode.trim()) {
    throw new HttpsError("invalid-argument", "A referral code is required.");
  }
  const referralCode = rawCode.trim().toUpperCase();

  const db = getFirestore();

  const referrerQuery = await db
    .collection("users")
    .where("referralCode", "==", referralCode)
    .limit(1)
    .get();

  if (referrerQuery.empty) {
    throw new HttpsError("not-found", "Invalid referral code.");
  }
  const referrerUid = referrerQuery.docs[0].id;

  if (referrerUid === uid) {
    throw new HttpsError("invalid-argument", "You can't refer yourself.");
  }

  const settingsSnap = await db.collection("settings").doc("global").get();
  const settings = settingsSnap.data();
  const referrerBonus = settings?.referralBonusReferrer;
  const referredBonus = settings?.referralBonusReferred;
  const tier2Bonus: number = settings?.referralTier2Bonus ?? 0;

  if (!referrerBonus || !referredBonus || referrerBonus <= 0 || referredBonus <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Referral rewards are not configured yet. Please try again later."
    );
  }

  const referredUserRef = db.collection("users").doc(uid);
  const referrerUserRef = db.collection("users").doc(referrerUid);
  const referrerWalletRef = db.collection("wallets").doc(referrerUid);
  const referredWalletRef = db.collection("wallets").doc(uid);

  const newBalance = await db.runTransaction(async (t) => {
    // All reads must happen before any writes in a Firestore transaction.
    const [referredUserSnap, referrerUserSnap, referrerWalletSnap, referredWalletSnap] =
      await Promise.all([
        t.get(referredUserRef),
        t.get(referrerUserRef),
        t.get(referrerWalletRef),
        t.get(referredWalletRef),
      ]);

    if (!referredUserSnap.exists) {
      throw new HttpsError("not-found", "Your profile could not be found.");
    }
    if (referredUserSnap.data()?.referredBy) {
      throw new HttpsError("already-exists", "You've already used a referral code.");
    }
    if (!referrerWalletSnap.exists || !referredWalletSnap.exists) {
      throw new HttpsError("not-found", "A wallet involved in this referral could not be found.");
    }

    // Determine tier-2 recipient (the referrer's own referrer), if any,
    // and read their wallet too — still a read, so still allowed here.
    const grandparentUid: string | null = referrerUserSnap.exists
      ? referrerUserSnap.data()?.referredBy ?? null
      : null;
    const applyTier2 = tier2Bonus > 0 && !!grandparentUid && grandparentUid !== uid;

    const grandparentWalletRef = applyTier2
      ? db.collection("wallets").doc(grandparentUid as string)
      : null;
    const grandparentWalletSnap = grandparentWalletRef
      ? await t.get(grandparentWalletRef)
      : null;
    const grandparentEligible = !!grandparentWalletSnap?.exists;

    // --- Writes from here on ---

    const referrerBefore = referrerWalletSnap.data()!.coins ?? 0;
    const referrerAfter = referrerBefore + referrerBonus;
    const referredBefore = referredWalletSnap.data()!.coins ?? 0;
    const referredAfter = referredBefore + referredBonus;

    t.update(referredUserRef, { referredBy: referrerUid });

    t.update(referrerWalletRef, {
      coins: referrerAfter,
      totalEarned: FieldValue.increment(referrerBonus),
      updatedAt: FieldValue.serverTimestamp(),
    });
    t.update(referredWalletRef, {
      coins: referredAfter,
      totalEarned: FieldValue.increment(referredBonus),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const referrerTxRef = db.collection("transactions").doc();
    t.set(referrerTxRef, {
      id: referrerTxRef.id,
      uid: referrerUid,
      type: "referral_bonus",
      amount: referrerBonus,
      balanceBefore: referrerBefore,
      balanceAfter: referrerAfter,
      status: "completed",
      sourceId: uid,
      description: "Referral bonus — a friend joined using your code",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "system",
    });

    const referredTxRef = db.collection("transactions").doc();
    t.set(referredTxRef, {
      id: referredTxRef.id,
      uid,
      type: "referral_bonus",
      amount: referredBonus,
      balanceBefore: referredBefore,
      balanceAfter: referredAfter,
      status: "completed",
      sourceId: referrerUid,
      description: "Referral bonus — welcome to PlayVerse",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "system",
    });

    if (applyTier2 && grandparentEligible && grandparentWalletRef && grandparentWalletSnap) {
      const grandparentBefore = grandparentWalletSnap.data()!.coins ?? 0;
      const grandparentAfter = grandparentBefore + tier2Bonus;

      t.update(grandparentWalletRef, {
        coins: grandparentAfter,
        totalEarned: FieldValue.increment(tier2Bonus),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const grandparentTxRef = db.collection("transactions").doc();
      t.set(grandparentTxRef, {
        id: grandparentTxRef.id,
        uid: grandparentUid,
        type: "referral_bonus",
        amount: tier2Bonus,
        balanceBefore: grandparentBefore,
        balanceAfter: grandparentAfter,
        status: "completed",
        sourceId: uid,
        description: "Tier 2 referral bonus — your network grew two levels deep",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "system",
      });
    }

    const referralRef = db.collection("referrals").doc();
    t.set(referralRef, {
      id: referralRef.id,
      referrerUid,
      referredUid: uid,
      referrerBonus,
      referredBonus,
      tier2Uid: applyTier2 && grandparentEligible ? grandparentUid : null,
      tier2Bonus: applyTier2 && grandparentEligible ? tier2Bonus : 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    return referredAfter;
  });

  return { success: true, newBalance };
});
