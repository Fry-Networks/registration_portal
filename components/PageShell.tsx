import React from 'react';
import Breadcrumbs from './Breadcrumbs';
import GenesisMintBanner from './GenesisMintBanner';

interface PageShellProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  breadcrumb?: boolean;
  className?: string;
  actions?: React.ReactNode;
}

export default function PageShell({ children, title, description, breadcrumb = false, className = '', actions }: PageShellProps) {
  return (
    <div className={`w-full min-h-screen bg-gradient-to-b from-surface to-[#0D0D12] text-ink ${className}`}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Genesis NFT banner — appears on every page */}
        <div className="pt-4 md:pt-6">
          <GenesisMintBanner />
        </div>
        {/* Sticky page header */}
        {(breadcrumb || title || description || actions) && (
          <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-md border-b border-divider py-5 md:py-6 mb-6 md:mb-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div className="flex-1 min-w-0">
                {breadcrumb && <div className="mb-2"><Breadcrumbs /></div>}
                {title && (
                  <h1 className="font-display text-3xl font-bold tracking-tight text-ink-primary">
                    {title}
                  </h1>
                )}
                {description && (
                  <p className="mt-1 text-sm text-ink-secondary">
                    {description}
                  </p>
                )}
              </div>
              {actions && (
                <div className="flex items-center gap-3 shrink-0">
                  {actions}
                </div>
              )}
            </div>
          </header>
        )}
        <main className="pb-12 md:pb-16">{children}</main>
      </div>
    </div>
  );
}
