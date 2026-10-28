import type { Metadata } from "next";
import TeacherShell from "@/components/teacher/TeacherShell";
import "@/app/dashboard/dashboard.css";
import "@/app/auth.css";
import "@/app/dashboard/admin/admin.css"; // نفس ستايلات إدارة الكورسات (الجداول والنماذج) المستخدمة في صفحات كورسات المدرّس
import "./teacher.css";

export const metadata: Metadata = { title: "لوحة المدرّس | EduHelp" };

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <TeacherShell>{children}</TeacherShell>;
}
