"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function SuccessBanner({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      // Remove o ?ok= da URL sem recarregar a página
      const url = new URL(window.location.href);
      url.searchParams.delete("ok");
      router.replace(url.pathname + (url.search || ""), { scroll: false });
    }, 3000);
    return () => clearTimeout(t);
  }, [router]);

  if (!visible) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-300">
      <span>✓</span>
      <span>{message}</span>
    </div>
  );
}
