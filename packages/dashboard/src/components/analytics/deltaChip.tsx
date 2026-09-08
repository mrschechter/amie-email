import styles from "./analytics.module.css";

export default function DeltaChip({
  delta,
  lowerIsBetter = false,
}: {
  delta: number | null;
  lowerIsBetter?: boolean;
}) {
  const good =
    delta !== null && delta !== 0 && (lowerIsBetter ? delta < 0 : delta > 0);
  const bad = delta !== null && delta !== 0 && !good;
  return (
    <span
      className={`${styles.delta} ${good ? styles.good : ""} ${bad ? styles.bad : ""}`}
      title="Relative change versus the immediately preceding period of equal length"
    >
      {delta === null
        ? "New · previous was 0"
        : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}% vs previous`}
    </span>
  );
}
