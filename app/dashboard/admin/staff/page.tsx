import StaffAccountsManager from "@/components/admin/StaffAccountsManager";
import "./staff.css";

export default function AdminStaffPage() {
  return <>
    <div className="adm-head">
      <h1>حسابات الوكلاء</h1>
      <p>أنشئ حسابًا بصلاحية محددة: تصحيح المقالات، إدارة الكورسات، إدارة المنتدى، أو مراجعة طلبات الدفع.</p>
    </div>
    <StaffAccountsManager />
  </>;
}
