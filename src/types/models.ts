// Mirrors 02-FIRESTORE-SCHEMA.md. Keep identical to the other two projects.
import type { firestore } from "firebase-admin";

export type UserStatus = "active" | "blocked";

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone: string | null;
  photoURL: string | null;
  referralCode: string;
  referredBy: string | null;
  level: number;
  status: UserStatus;
  createdAt: firestore.FieldValue | firestore.Timestamp;
  lastLoginAt: firestore.FieldValue | firestore.Timestamp;
}

export interface Wallet {
  uid: string;
  coins: number;
  pendingWithdrawal: number;
  totalEarned: number;
  totalWithdrawn: number;
  updatedAt: firestore.FieldValue | firestore.Timestamp;
}

export type TransactionType =
  | "daily_reward"
  | "game_reward"
  | "task_reward"
  | "referral_bonus"
  | "bonus_reward"
  | "withdrawal_hold"
  | "withdrawal_approved"
  | "withdrawal_rejected"
  | "admin_adjustment";

export type TransactionStatus = "completed" | "pending" | "failed";

export interface Transaction {
  id: string;
  uid: string;
  type: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  status: TransactionStatus;
  sourceId: string | null;
  description: string;
  createdAt: firestore.FieldValue | firestore.Timestamp;
  createdBy: "system" | "admin";
}

export interface AdminUser {
  uid: string;
  name: string;
  email: string;
  role: "super_admin" | "admin";
  createdAt: firestore.FieldValue | firestore.Timestamp;
}

export type GameEngine = "flappy-birds" | "coin-clicker" | "color-match";

export interface Game {
  id: string;
  name: string;
  description: string;
  imageURL: string;
  engine: GameEngine;
  category: string;
  totalLevels: number;
  coinsPerLevel: number;
  gameURL: string | null;
  deepLinkURL: string | null; // native app deep link, tried before falling back to gameURL
  status: "active" | "inactive";
  isFeatured: boolean;
  playCount: number;
  createdAt: firestore.FieldValue | firestore.Timestamp;
  updatedAt: firestore.FieldValue | firestore.Timestamp;
}

export interface UserGameProgress {
  gameId: string;
  completedLevels: number[];
  lastCompletedLevel: number;
  totalCoinsEarned: number;
  updatedAt: firestore.FieldValue | firestore.Timestamp;
}

export type TaskType = "daily" | "weekly" | "special" | "social" | "app_engagement";

export interface Offer {
  id: string;
  title: string;
  description: string;
  imageURL: string | null;
  reward: number;
  type: "task" | "offer";
  taskType: TaskType | null; // set when type === "task"; null when type === "offer"
  status: "active" | "inactive";
  expiresAt: firestore.Timestamp | null;
  completionCount: number;
  createdAt: firestore.FieldValue | firestore.Timestamp;
  updatedAt: firestore.FieldValue | firestore.Timestamp;
}

export interface GlobalSettings {
  appName: string;
  logoURL: string;
  primaryColor: string;
  secondaryColor: string;
  coinToCurrencyRate: number;
  minWithdrawalAmount: number;
  maxWithdrawalAmount: number;
  dailyRewardAmount: number;
  referralBonusReferrer: number; // tier 1 — paid to the direct referrer
  referralBonusReferred: number; // paid to the newly-referred user
  referralTier2Bonus: number; // tier 2 — paid to the referrer's referrer, 0 disables it
  updatedAt: firestore.FieldValue | firestore.Timestamp;
}

export interface LeaderboardEntry {
  uid: string;
  name: string;
  photoURL: string | null;
  totalEarned: number;
  rank: number;
  updatedAt: firestore.FieldValue | firestore.Timestamp;
}

export interface Referral {
  id: string;
  referrerUid: string;
  referredUid: string;
  referrerBonus: number;
  referredBonus: number;
  tier2Uid: string | null;
  tier2Bonus: number;
  createdAt: firestore.FieldValue | firestore.Timestamp;
}
