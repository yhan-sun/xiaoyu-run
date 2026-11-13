import { motion, useReducedMotion } from "motion/react";
import type { StatRow } from "../../api";
import { Card } from "../ui/Card";

interface PlaceDistributionProps {
  byPlace: [string, number][];
  rows: StatRow[];
}

export function PlaceDistribution({ byPlace, rows }: PlaceDistributionProps) {
  const reduced = useReducedMotion();
  const places = byPlace.map(([name, count]) => {
    const own = rows.filter((r) => r.place === name);
    const validKm = own
      .filter((r) => r.valid)
      .reduce((sum, r) => sum + Math.max(0, r.km), 0);
    const invalidKm = own
      .filter((r) => !r.valid)
      .reduce((sum, r) => sum + Math.max(0, r.km), 0);
    return { name, count, validKm, invalidKm, totalKm: validKm + invalidKm };
  });

  const maxKm = Math.max(0.01, ...places.map((p) => p.totalKm));

  if (places.length === 0) return null;

  return (
    <Card className="place-dist" padded={false}>
      <div className="place-dist-head">
        <span className="place-dist-caption">按累计里程</span>
        <div className="place-legend">
          <span>
            <i className="legend-dot legend-dot--valid" />
            有效
          </span>
          <span>
            <i className="legend-dot legend-dot--invalid" />
            未通过
          </span>
        </div>
      </div>

      <div className="place-rows">
        {places.map((place) => {
          const total = place.totalKm;
          const validPct = total > 0 ? (place.validKm / total) * 100 : 0;
          const barPct = (total / maxKm) * 100;
          return (
            <div className="place-row" key={place.name}>
              <div className="place-row-head">
                <span className="place-row-name">{place.name}</span>
                <span className="place-row-meta num">
                  {place.count} 次 · {place.totalKm.toFixed(2)} km
                </span>
              </div>
              <div
                className="place-bar"
                role="img"
                aria-label={`${place.name}，${place.count} 次，${place.totalKm.toFixed(2)} 公里，其中有效 ${place.validKm.toFixed(2)} 公里`}
              >
                <motion.span
                  className="place-bar-total"
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${barPct}%` }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }
                  }
                >
                  <span
                    className="place-bar-valid"
                    style={{ width: `${validPct}%` }}
                  />
                </motion.span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
