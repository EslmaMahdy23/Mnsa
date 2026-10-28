import TeacherApplicationsManager from "@/components/admin/TeacherApplicationsManager";
import "./teacher-applications.css";

export default function AdminTeacherApplicationsPage() {
  return <>
    <div className="adm-head">
      <h1>طلبات المدرسين</h1>
      <p>راجع بيانات المتقدّمين للتدريس وسيرهم الذاتية، وفعّل حساب المدرّس بعد الموافقة.</p>
    </div>
    <TeacherApplicationsManager />
  </>;
}
