"use client";

import { createContext, useContext } from "react";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "student" | "teacher" | "admin" | "essay_grader" | "course_manager" | "forum_moderator" | "payment_manager" | "support_agent";
  phone: string | null;
  parent_phone: string | null;
  grade: number | null;
  joined_at: string | null; // تاريخ إنشاء الحساب
};

// balance = null لسه بيتحمّل (أو مقدرناش نجيبه)
type Ctx = { profile: Profile; balance: number | null; refresh: () => Promise<void> };

export const ProfileContext = createContext<Ctx | null>(null);

export const ROLE_LABEL: Record<string, string> = {
  student: "طالب",
  teacher: "مدرّس",
  admin: "أدمن",
  essay_grader: "مصحح مقالي",
  course_manager: "مدير محتوى",
  forum_moderator: "مسؤول المنتدى",
  payment_manager: "مسؤول طلبات الدفع",
  support_agent: "مسؤول الدعم",
};

// أي صفحة جوه الداشبورد تستخدمها عشان تجيب بيانات المستخدم الحالي
export function useProfile(): Profile {
  const c = useContext(ProfileContext);
  if (!c) throw new Error("useProfile لازم يتستخدم جوه DashboardShell");
  return c.profile;
}

// رصيد المحفظة للمستخدم الحالي
// ممكن يبقى null لو لسه بيتحمّل أو ملف 08_wallet.sql لسه ما اتشغّلش
export function useBalance(): number | null {
  const c = useContext(ProfileContext);
  if (!c) throw new Error("useBalance لازم يتستخدم جوه DashboardShell");
  return c.balance;
}

// بعد ما نعدّل البيانات في الداتابيز، نستدعيها عشان الشاشة كلها تتحدّث
export function useRefreshProfile(): () => Promise<void> {
  const c = useContext(ProfileContext);
  if (!c) throw new Error("useRefreshProfile لازم يتستخدم جوه DashboardShell");
  return c.refresh;
}
