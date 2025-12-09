import type { CSSProperties } from 'react';
import Lottie from 'lottie-react';
import ornamentsAnimation from '../public/holiday/Christmas Ornaments.json';

type ChristmasGarlandProps = {
  prefersReducedMotion?: boolean;
  showCssOrnaments?: boolean;
};

export default function ChristmasGarland({
  prefersReducedMotion = false,
  showCssOrnaments = false
}: ChristmasGarlandProps) {
  const total = 0; // legacy CSS ornaments disabled unless explicitly re-enabled

  return (
    <div className="christmas-garland" aria-hidden>
      {/* Xmas: Lottie ornament strip duplicated to span the navbar width. */}
      <div className="holiday-lottie-strip">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={`ornaments-${idx}`} className="holiday-lottie-ornaments">
            <Lottie
              animationData={ornamentsAnimation}
              loop={!prefersReducedMotion}
              autoplay={!prefersReducedMotion}
              rendererSettings={{ preserveAspectRatio: 'xMidYMid slice' }}
            />
          </div>
        ))}
      </div>

      {showCssOrnaments && (
        <div className="christmas-garland-track">
          <div className="christmas-garland-wire" />
        </div>
      )}
    </div>
  );
}
