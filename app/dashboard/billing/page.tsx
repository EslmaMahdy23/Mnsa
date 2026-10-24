"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LoadingState from "@/components/dashboard/LoadingState";

// الفواتير والاشتراكات اتنقلت جوه صفحة "حسابي". الرابط القديم بيحوّل لهناك.
export default function BillingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/profile#billing");
  }, [router]);
  return <LoadingState label="بنحوّلك للفواتير والاشتراكات" detail="لحظة ونفتحها لك" />;
}
