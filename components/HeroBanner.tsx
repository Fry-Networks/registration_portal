import type { ReactNode } from 'react';
import type { StaticImageData } from 'next/image';
import type { SeasonalThemeKey } from '../lib/holidays';
import { useTokenPrices } from '../lib/hooks/useTokenPrices';

type HeroLink = {
  label: string;
  href: string;
};

type HeroBannerProps = {
  title: string;
  subtitle: string;
  backgroundImage?: StaticImageData;
  links?: HeroLink[];
  rightSlot?: ReactNode;
  showPrices?: boolean;
  mode?: 'light' | 'dark';
  holidayKey?: SeasonalThemeKey | null;
};

const formatPrice = (value?: number): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '$0.000000';
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(6)}`;
};

const PriceChip = ({
  label,
  value,
  valueText,
  description
}: {
  label: string;
  value?: number;
  valueText?: string;
  description?: string;
}) => {
  const display =
    typeof value === 'number' && Number.isFinite(value)
      ? formatPrice(value)
      : valueText ?? '—';

  return (
    <div className="rounded-2xl border border-red-400/40 bg-black/30 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-red-100 shadow-[0_0_15px_rgba(255,0,76,0.25)]">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-red-300/80">{label}</span>
        <span className="font-mono text-sm text-white normal-case">{display}</span>
      </div>
      {description && (
        <p className="mt-1 text-[10px] font-normal leading-relaxed text-red-100/80 normal-case">
          {description}
        </p>
      )}
    </div>
  );
};

export default function HeroBanner({
  title,
  subtitle,
  backgroundImage,
  links,
  rightSlot,
  showPrices = true,
  mode = 'dark',
  holidayKey
}: HeroBannerProps) {
  const prices = useTokenPrices();
  const isDark = mode === 'dark';
  const lightGradient = 'bg-gradient-to-r from-[#e54152] via-[#d92b3c] to-[#e75b66]';
  const isChristmas = holidayKey === 'christmas';
  // Xmas: Extra top padding keeps text clear of the garland/Lottie layer.
  const holidayPadding = isChristmas ? 'pt-16 pb-10' : 'py-8';

  return (
    <section
      className={`relative overflow-hidden rounded-3xl px-6 ${holidayPadding} shadow-[0_25px_60px_rgba(0,0,0,0.45)] ${isChristmas ? 'holiday-card-badge' : ''} ${
        isDark
          ? 'border border-red-500/40 bg-gradient-to-r from-[#190104] via-[#36000b] to-[#130005]'
          : `border border-red-500/50 ${lightGradient}`
      }`}
    >
      {backgroundImage && (
        <div
          aria-hidden
          className={`absolute inset-0 ${isDark ? 'opacity-30' : 'opacity-25'}`}
          style={{
            backgroundImage: `url(${backgroundImage.src})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        />
      )}
      <div
        className={`absolute inset-0 pointer-events-none ${
          isDark
            ? 'bg-gradient-to-br from-black/70 via-red-900/20 to-black/60'
            : 'bg-gradient-to-br from-white/60 via-red-200/35 to-white/30'
        }`}
      />
      <div
        className={`absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,0,72,0.35),_transparent_50%)] ${
          isDark ? 'opacity-60' : 'opacity-55'
        }`}
      />
      {isChristmas && (
        <>
          {/* Xmas: Neon frame + holographic sheen to give the hero a futuristic edge. */}
          <div className="hero-neon-frame" aria-hidden />
          <div className="hero-holo-sheen" aria-hidden />
          {/* Xmas: Sparse drifting ornaments to add motion without blocking content. */}
          <div className="hero-christmas-particles" aria-hidden />
          {/* Festive edge lights */}
          <div className="holiday-lights" aria-hidden />
          {/* Gentle sparkle layer to add depth without blocking interactions */}
          <div className="holiday-hero-sparkle" aria-hidden />
        </>
      )}
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <p className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.4em] ${isDark ? 'text-red-200/70' : 'text-red-700/70'}`}>
            {isChristmas && (
              <span role="img" aria-label="Santa" className="text-lg sm:text-xl">
                🎅
              </span>
            )}
            Fry Networks
          </p>
          <h1 className={`text-3xl font-semibold sm:text-4xl ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h1>
          <p className={`text-sm sm:text-base ${isDark ? 'text-red-100/90' : 'text-slate-700'}`}>{subtitle}</p>
          {links && links.length > 0 && (
            <div
              className={`flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-wide ${
                isDark ? 'text-red-200/90' : 'text-red-700/90'
              }`}
            >
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-red-200/90 transition hover:text-white"
                >
                  {/* Darker, thicker bullet for better visibility in light mode */}
                  <span className="h-2 w-2 rounded-full bg-red-600 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]" />
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
        {rightSlot && <div className="text-right">{rightSlot}</div>}
      </div>
      {showPrices && (
        <div className="relative mt-6 flex flex-wrap items-stretch gap-3">
          <PriceChip label="FRY 2.0" value={prices.fry2} />
          <PriceChip label="fNode" value={prices.fnode} />
          <PriceChip
            label="tFRY"
            valueText="• Non-tradeable"
            description="Generated by designated miners while waiting for monetization. Each tFRY will be able to convert at a 1:1 ratio into the device’s segmented token once that product goes live."
          />
        </div>
      )}
      {/* Xmas: Label suppressed to avoid redundant “Holiday Mode” pill in hero. */}
    </section>
  );
}
