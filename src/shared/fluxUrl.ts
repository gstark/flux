import { readDaemonConfig } from "../cli/daemon-common";

const DEFAULT_PORT = "8042";

export function resolveFluxUrl(): string {
  if (process.env.FLUX_URL) {
    return process.env.FLUX_URL;
  }
  if (process.env.FLUX_PORT) {
    return `http://localhost:${process.env.FLUX_PORT}`;
  }
  try {
    const { fluxPort } = readDaemonConfig();
    return `http://localhost:${fluxPort}`;
  } catch {
    return `http://localhost:${DEFAULT_PORT}`;
  }
}
