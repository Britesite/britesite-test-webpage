import { getTranslations } from "next-intl/server";

const DAYS = ["mon", "tueFri", "weekend"] as const;

/** Opening hours as a definition list; the text lives in messages `info.hours`. */
export async function OpeningHours({ className = "" }: { className?: string }) {
  const t = await getTranslations("info");
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 ${className}`}>
      {DAYS.map((day) => (
        <div key={day} className="contents">
          <dt>{t(`hours.${day}.day`)}</dt>
          <dd className="text-right tabular-nums font-medium">{t(`hours.${day}.time`)}</dd>
        </div>
      ))}
    </dl>
  );
}
