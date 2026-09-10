"use client";

import { useTranslations } from "next-intl";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-neutral-300 mb-4">500</p>
        <h1 className="text-2xl font-semibold mb-2">{t("title")}</h1>
        <p className="text-neutral-600 mb-8">{t("description")}</p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition-[color,background-color,border-color] hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          {t("tryAgain")}
        </button>
      </div>
    </div>
  );
}
