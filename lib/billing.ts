// أدوات صغيرة للفواتير والاشتراكات

export const PAY_METHOD: Record<string, string> = {
  wallet: "رصيد المحفظة",
  transfer: "تحويل على المحفظة",
  activation_code: "كود تفعيل",
};

// حالة الفاتورة: مشتريات الكورسات (paid / refunded) وطلبات الشحن (pending / approved / rejected)
export const INVOICE_STATUS: Record<string, string> = {
  paid: "مدفوع",
  refunded: "مُسترد",
  pending: "قيد المراجعة",
  approved: "تم الشحن",
  rejected: "اترفض",
};

export const INVOICE_KIND: Record<string, string> = {
  purchase: "شراء كورس",
  topup: "شحن رصيد",
};

// نوع الاشتراك: اتشترى من الرصيد، أو كورس مجاني، أو الإدارة سجّلته (مثلاً بعد دفع خارجي)
export const SUB_KIND: Record<string, string> = {
  purchase: "مدفوع",
  free: "مجاني",
  admin: "من الإدارة",
};

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
