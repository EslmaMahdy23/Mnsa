"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";
import { fmtMoney } from "@/lib/wallet";
import "./wallet-cards.css";

type GeneratedCard = { generated_code: string; card_amount: number; max_uses: number };

export default function WalletCardsManager() {
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("1");
  const [maxUses, setMaxUses] = useState("1");
  const [cards, setCards] = useState<GeneratedCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setCards([]);

    const parsedAmount = Number(amount);
    const parsedCount = Number(count);
    const parsedMaxUses = Number(maxUses);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 20000) {
      setError("اكتب قيمة الكارت من 1 إلى 20,000 جنيه.");
      return;
    }
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 500) {
      setError("عدد الكروت لازم يكون من 1 إلى 500.");
      return;
    }
    if (!Number.isInteger(parsedMaxUses) || parsedMaxUses < 1 || parsedMaxUses > 500) {
      setError("عدد مرات استخدام الكود لازم يكون من 1 إلى 500.");
      return;
    }

    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("admin_generate_wallet_cards", {
      p_amount: parsedAmount,
      p_count: parsedCount,
      p_max_uses: parsedMaxUses,
    });
    setBusy(false);
    if (rpcError) {
      console.error("wallet card generation failed:", rpcError);
      setError(rpcError.code === "PGRST202"
        ? "شغّل ملف supabase/27_wallet_card_use_limits.sql في Supabase الأول."
        : adminErrorMessage(rpcError, "مقدرناش نولّد الكروت، جرّب تاني."));
      return;
    }

    const generated = (data ?? []) as GeneratedCard[];
    setCards(generated);
    setAmount("");
    setNotice("تم إنشاء الأكواد. انسخها واحفظها الآن؛ مش هتظهر مرة تانية بعد مغادرة الصفحة.");
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(cards.map((card) => card.generated_code).join("\n"));
      setNotice("تم نسخ الأكواد.");
    } catch {
      setError("النسخ التلقائي مش متاح. حدّد الأكواد وانسخها يدويًا.");
    }
  }

  return (
    <div className="wallet-cards-admin" dir="rtl">
      <header className="wallet-cards-intro">
        <span><i className="fa-solid fa-ticket-simple" /></span>
        <div><h1>كروت شحن المحفظة</h1><p>ولّد أكوادًا من 11 رقمًا، وكل كود يُستخدم مرة واحدة لإضافة قيمته لرصيد الطالب.</p></div>
      </header>

      {error && <p className="msg-error" role="alert">{error}</p>}
      {notice && <p className="wallet-cards-notice"><i className="fa-solid fa-circle-info" /> {notice}</p>}

      <form className="card wallet-cards-form" onSubmit={generate}>
        <label>قيمة الكارت بالجنيه
          <input type="number" min="1" max="20000" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="مثال: 100" />
        </label>
        <label>عدد الكروت
          <input type="number" min="1" max="500" step="1" inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value)} />
        </label>
        <label>مرات استخدام كل كود
          <input type="number" min="1" max="500" step="1" inputMode="numeric" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
          <small>كل طالب يقدر يستخدم نفس الكود مرة واحدة.</small>
        </label>
        <button className="btn" disabled={busy}>{busy ? "جارٍ توليد الأكواد..." : <><i className="fa-solid fa-wand-magic-sparkles" /> توليد الكروت</>}</button>
      </form>

      {cards.length > 0 && <section className="wallet-cards-results">
        <div className="wallet-cards-results-head"><h2>الأكواد الجديدة</h2><button className="btn btn-outline btn-sm" onClick={() => void copyAll()}><i className="fa-regular fa-copy" /> نسخ كل الأكواد</button></div>
        <div className="wallet-cards-grid">
          {cards.map((card) => <article className="card wallet-card-code" key={card.generated_code}>
            <code dir="ltr">{card.generated_code}</code><span>{fmtMoney(Number(card.card_amount))} · ٠/{card.max_uses.toLocaleString("ar-EG")}</span>
          </article>)}
        </div>
        <p className="wallet-cards-warning"><i className="fa-solid fa-triangle-exclamation" /> الأكواد تظهر هنا مرة واحدة فقط. كل كود صالح لعدد الاستخدامات المحدد، وكل طالب يقدر يشحنه مرة واحدة.</p>
      </section>}
    </div>
  );
}
