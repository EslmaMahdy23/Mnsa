import Link from "next/link";
import MyLectureSchedules from "@/components/dashboard/MyLectureSchedules";

export default function LectureSchedulesPage() {
  return (
    <div className="lecture-schedules-page" dir="rtl">
      <div className="lecture-page-topbar">
        <Link href="/dashboard/profile" className="lecture-back-link"><i className="fa-solid fa-arrow-right" /> رجوع لحسابي</Link>
        <span className="lecture-page-kicker"><i className="fa-solid fa-calendar-days" /> جدولك الدراسي</span>
      </div>
      <MyLectureSchedules />
    </div>
  );
}
