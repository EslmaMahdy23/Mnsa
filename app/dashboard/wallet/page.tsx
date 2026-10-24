"use client";

import { useBalance } from "@/components/dashboard/ProfileContext";
import WalletTopup from "@/components/dashboard/WalletTopup";
import { fmtMoney } from "@/lib/wallet";
import "./wallet.css";

export default function WalletPage() {
  const balance = useBalance();

  return (
    <main className="wallet-page" dir="rtl">
      <header className="wallet-page-intro">
        <div><span>إدارة أموالك</span><h1>محفظتي</h1><p>رصيدك وطلبات الشحن كلها في مكان واحد.</p></div>
        <span className="wallet-page-secure"><i className="fa-solid fa-lock" /> دفع آمن</span>
      </header>

      <section className="wallet-spotlight" aria-label="رصيد المحفظة الحالي">
        <span className="wallet-spotlight-orbit wallet-orbit-a" /><span className="wallet-spotlight-orbit wallet-orbit-b" />
        <div className="wallet-spotlight-top">
          <span className="wallet-spotlight-icon"><i className="fa-solid fa-wallet" /></span>
          <span className="wallet-spotlight-tag"><i className="fa-solid fa-circle-check" /> محفظتك التعليمية</span>
        </div>
        <div className="wallet-spotlight-content">
          <div><span className="wallet-spotlight-label">الرصيد المتاح</span><strong>{balance === null ? "—" : fmtMoney(balance)}</strong><small>تقدر تستخدم رصيدك للاشتراك في الكورسات</small></div>
          <span className="wallet-spotlight-art"><i className="fa-solid fa-coins" /></span>
        </div>
        <div className="wallet-spotlight-bottom"><span><i className="fa-solid fa-shield-halved" /> رصيدك محفوظ في حسابك</span><span>MN<span className="wallet-spotlight-dot">.</span>SA</span></div>
      </section>

      <WalletTopup />
    </main>
  );
}
