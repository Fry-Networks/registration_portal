import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

const pathLabelMap: Record<string, string> = {
  'my_registrations': 'My Registrations',
  'new_registration': 'New Registration',
  'device-credentials': 'Device Credentials',
  'my-keys': 'My Keys',
  'buy': 'Buy',
};

function segmentToLabel(segment: string): string {
  if (pathLabelMap[segment]) return pathLabelMap[segment];
  return segment
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Breadcrumbs() {
  const router = useRouter();
  const pathname = router.pathname;

  if (pathname === '/' || pathname === '') return null;

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 1) return null;

  const crumbs = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const label = segmentToLabel(segment);
    const isLast = index === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-space-3">
      <ol className="flex flex-wrap items-center gap-space-2 text-display-xs">
        <li>
          <Link
            href="/"
            className="text-ink-muted hover:text-ink-accent transition-fast"
          >
            Home
          </Link>
        </li>
        {crumbs.map((crumb, i) => (
          <li key={crumb.href} className="flex items-center gap-space-2">
            <span className="text-ink-muted select-none">/</span>
            {crumb.isLast ? (
              <span className="text-ink-primary font-medium" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="text-ink-secondary hover:text-ink-accent transition-fast"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
