export default function RateCell({
  count,
  denominator,
}: {
  count: number;
  denominator: number;
}) {
  return (
    <span title={`${count.toLocaleString()} / ${denominator.toLocaleString()}`}>
      {(denominator ? (count / denominator) * 100 : 0).toFixed(1)}%
    </span>
  );
}
