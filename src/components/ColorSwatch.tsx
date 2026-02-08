export function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-4 w-4 rounded-full border border-base-content/20"
      style={{ backgroundColor: color }}
    />
  );
}
