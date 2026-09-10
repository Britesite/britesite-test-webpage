import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { buildMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // titleAbsolute: the homepage title is the full brand statement; the
  // "%s | Company" template would otherwise duplicate the company name.
  return buildMetadata({ locale, path: "", metaKey: "home", titleAbsolute: true });
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-2xl px-6">
        <h1 className="text-4xl font-bold mb-4">
          Britesite Test
        </h1>
        <p className="text-lg text-neutral-600 mb-8">
          This paragraph is a safe place to test font-size changes.
        </p>
        <p className="text-sm text-neutral-400">
          Changes here affect only this test website.
        </p>
      </div>
    </div>
  );
}
