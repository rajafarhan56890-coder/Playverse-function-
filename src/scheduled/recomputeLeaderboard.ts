import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const TOP_N = 100;

/**
 * Recomputes the top-N leaderboard from real wallet.totalEarned values
 * every 15 minutes. The mobile app reads from the precomputed
 * `leaderboard` collection (cheap, real-time-subscribable) instead of
 * scanning every wallet on every screen view.
 *
 * Runs as a batch write, not one doc at a time, and clears stale entries
 * (a user who drops out of the top N is removed, not left stranded with
 * an old rank).
 */
export const recomputeLeaderboard = onSchedule("every 15 minutes", async () => {
  const db = getFirestore();

  const topWallets = await db
    .collection("wallets")
    .orderBy("totalEarned", "desc")
    .limit(TOP_N)
    .get();

  const uids = topWallets.docs.map((d) => d.id);

  // Fetch matching profiles for display name/photo. Firestore 'in' queries
  // cap at 30 IDs per call, so batch them.
  const profilesByUid = new Map<string, { name: string; photoURL: string | null }>();
  for (let i = 0; i < uids.length; i += 30) {
    const batch = uids.slice(i, i + 30);
    if (batch.length === 0) continue;
    const snap = await db
      .collection("users")
      .where("__name__", "in", batch)
      .get();
    snap.docs.forEach((d) => {
      const data = d.data();
      profilesByUid.set(d.id, { name: data.name ?? "PlayVerse Player", photoURL: data.photoURL ?? null });
    });
  }

  const previousSnap = await db.collection("leaderboard").get();
  const previousUids = new Set(previousSnap.docs.map((d) => d.id));

  const batch = db.batch();

  topWallets.docs.forEach((walletDoc, index) => {
    const uid = walletDoc.id;
    const profile = profilesByUid.get(uid);
    const ref = db.collection("leaderboard").doc(uid);
    batch.set(ref, {
      uid,
      name: profile?.name ?? "PlayVerse Player",
      photoURL: profile?.photoURL ?? null,
      totalEarned: walletDoc.data().totalEarned ?? 0,
      rank: index + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    previousUids.delete(uid);
  });

  // Anyone left in previousUids fell out of the top N — remove them.
  previousUids.forEach((staleUid) => {
    batch.delete(db.collection("leaderboard").doc(staleUid));
  });

  await batch.commit();
});
