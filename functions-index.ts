import { initializeApp } from "firebase-admin/app";

initializeApp();

export { onUserCreate } from "./triggers/onUserCreate";
export { addAdmin } from "./callable/addAdmin";
export { claimDailyReward } from "./callable/claimDailyReward";
export { completeGame } from "./callable/completeGame";
export { completeTask } from "./callable/completeTask";
export { completeLevelAndClaimCoins } from "./callable/completeLevelAndClaimCoins";
export { applyReferralBonus } from "./callable/applyReferralBonus";
export { grantBonusReward } from "./callable/grantBonusReward";
export { recomputeLeaderboard } from "./scheduled/recomputeLeaderboard";
export { requestWithdrawal } from "./callable/requestWithdrawal";
export { adminApproveWithdrawal } from "./callable/adminApproveWithdrawal";
export { adminRejectWithdrawal } from "./callable/adminRejectWithdrawal";
export { adminSetUserStatus } from "./callable/adminSetUserStatus";
export { adminAdjustBalance } from "./callable/adminAdjustBalance";
