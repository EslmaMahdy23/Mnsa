import { useEffect, useState } from "react";

// بيأخّر تحديث القيمة شوية (مثلاً أثناء الكتابة في البحث)، عشان ما نبعتش طلب للداتابيز مع كل حرف
export function useDebounce<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
