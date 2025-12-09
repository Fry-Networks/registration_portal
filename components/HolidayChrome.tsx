import { useEffect, useState } from 'react';
// Xmas: Garland overlay for hanging ornaments when Christmas mode is active.
import ChristmasGarland from './ChristmasGarland';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider';

// Lightweight global overlay for holiday flair (snow + garland). Everything is client-only and respects reduced motion.
export default function HolidayChrome() {
  const { activeHoliday } = useSeasonalTheme();
  const isChristmas = activeHoliday?.key === 'christmas';
  const [reducedMotion, setReducedMotion] = useState(false);
  const [Snowfall, setSnowfall] = useState<any>(null);

  useEffect(() => {
    // Honor reduced motion so snowfall can be toned down/disabled.
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReducedMotion(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    // Lazy-load snow client-side only to keep SSR lean.
    if (!isChristmas) return;
    import('react-snowfall')
      .then(mod => setSnowfall(() => mod.default))
      .catch(err => {
        console.error('[HolidayChrome] Failed to load react-snowfall', err);
      });
  }, [isChristmas]);

  if (!isChristmas) return null;

  return (
    <>
      {/* Soft snowfall overlay via react-snowfall; snowflakeCount dials down when users prefer reduced motion. */}
      {Snowfall && (
        <Snowfall
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 120
          }}
          snowflakeCount={reducedMotion ? 35 : 110}
          color={reducedMotion ? '#e5e7eb' : '#ffffff'}
          speed={[0.5, reducedMotion ? 1.2 : 2.5]}
          wind={[-0.5, 1.5]}
        />
      )}

      {/* Garland sits under the navbar; animated glow + gentle sway lives in CSS. */}
      <ChristmasGarland prefersReducedMotion={reducedMotion} />
    </>
  );
}
