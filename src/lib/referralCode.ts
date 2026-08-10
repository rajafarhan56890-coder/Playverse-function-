import { getFirestore } from "firebase-admin/firestore";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
const CODE_LENGTH = 7;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/**
 * Generates a referral code guaranteed unique across `users`, retrying on
 * the (astronomically rare) collision. Called only from onUserCreate,
 * never exposed to clients.
 */
export async function generateUniqueReferralCode(): Promise<string> {
  const db = getFirestore();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const existing = await db
      .collection("users")
      .where("referralCode", "==", code)
      .limit(1)
      .get();
    if (existing.empty) return code;
  }
  throw new Error("Could not generate a unique referral code after 10 attempts.");
}
