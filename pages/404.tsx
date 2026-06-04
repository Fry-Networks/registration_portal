import Head from 'next/head';
import Link from 'next/link';
import { useTheme } from 'next-themes';

export default function Custom404() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  return (
    <>
      <Head>
        <title>Page Not Found | Fry Networks</title>
      </Head>
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <h1 className={`text-6xl font-bold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>
          404
        </h1>
        <p className={`text-xl mb-8 ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
          This page could not be found.
        </p>
        <Link
          href="/"
          className="px-6 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-500 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </>
  );
}
