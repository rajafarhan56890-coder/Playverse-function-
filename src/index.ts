import { initializeApp } from "firebase-admin/app";

initializeApp();

// TRIGGERS
export { onUserCreate } from "./triggers/onUserCreate";

// CALLABLE FUNCTIONS - ADMIN
export { addAdmin } from "./callable/addAdmin";
export { adminAdjustBalance } from "./callable/adminAdjustBalance";
export { adminApproveWithdrawal } from "./callable/adminApproveWithdrawal";
export { adminRejectWithdrawal } from "./callable/adminRejectWithdrawal";
export { adminSetUserStatus } from "./callable/adminSetUserStatus";

// CALLABLE FUNCTIONS - GAMES (PART 1)
export { completeGame } from "./callable/completeGame";
export { completeTask } from "./callable/completeTask";
export { completeLevelAndClaimCoins } from "./callable/completeLevelAndClaimCoins";

// CALLABLE FUNCTIONS - REFERRAL & REWARDS
export { applyReferralBonus } from "./callable/applyReferralBonus";
export { claimDailyReward } from "./callable/claimDailyReward";
export { grantBonusReward } from "./callable/grantBonusReward";

// CALLABLE FUNCTIONS - WITHDRAWAL
export { requestWithdrawal } from "./callable/requestWithdrawal";

// CALLABLE FUNCTIONS - SETTINGS (PART 2)
export { updateGlobalSettings } from "./callable/updateGlobalSettings";

// SCHEDULED FUNCTIONS
export { recomputeLeaderboard } from "./scheduled/recomputeLeaderboard";
