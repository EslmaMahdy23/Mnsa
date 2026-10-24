"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; message: string };
const LIFETIME = 4500;
const ERROR_SELECTOR = ".msg-error, .profile-results-error";

export default function ErrorToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let nextId = 0;
    const scan = () => {
      document.querySelectorAll<HTMLElement>(ERROR_SELECTOR).forEach((source) => {
        const message = source.innerText.trim();
        if (!message) {
          delete source.dataset.errorToastMessage;
          delete source.dataset.errorToastHide;
          return;
        }
        if (source.dataset.errorToastMessage === message) return;

        source.dataset.errorToastMessage = message;
        const hasAction = Boolean(source.querySelector("a, button, [role='button']"));
        source.dataset.errorToastHide = hasAction ? "false" : "true";
        const id = ++nextId;
        setToasts((current) => [...current.slice(-2), { id, message }]);
        window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), LIFETIME);
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="error-toast-viewport" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => <div className="error-toast" role="alert" key={toast.id}>
        <span className="error-toast-icon"><i className="fa-solid fa-triangle-exclamation" /></span>
        <span className="error-toast-message">{toast.message}</span>
        <button type="button" className="error-toast-close" aria-label="إغلاق التنبيه" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><i className="fa-solid fa-xmark" /></button>
        <span className="error-toast-progress" style={{ animationDuration: `${LIFETIME}ms` }} />
      </div>)}
    </div>
  );
}
