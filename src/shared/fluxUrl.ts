const DEFAULT_PORT = "8042";

export function resolveFluxUrl(): string {
  return (
    process.env.FLUX_URL ??
    `http://localhost:${process.env.FLUX_PORT ?? DEFAULT_PORT}`
  );
}
