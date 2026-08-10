import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

/**
 * Throws a properly-typed HttpsError if the caller isn't signed in.
 * Every callable function must call this first, before touching Firestore.
 */
export function assertSignedIn(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in to perform this action."
    );
  }
  return request.auth.uid;
}

/**
 * Throws unless the caller's ID token carries the `admin` custom claim.
 * This is the ONLY source of truth for admin authorization — never trust
 * an `isAdmin` field sent from the client, and never trust Firestore data
 * alone, since rules can't be re-checked inside a Cloud Function the way
 * a custom claim baked into the verified token can.
 */
export function assertIsAdmin(request: CallableRequest): string {
  const uid = assertSignedIn(request);
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError(
      "permission-denied",
      "This action requires admin privileges."
    );
  }
  return uid;
}
