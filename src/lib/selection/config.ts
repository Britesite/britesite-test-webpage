type Environment = Record<string, string | undefined>;

export type SelectionBridgeConfig = {
  origin: string | null;
  frameAncestors: string;
  xFrameOptions: "DENY" | null;
};

function canonicalHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname === "localhost" || url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function selectionBridgeConfig(env: Environment = process.env): SelectionBridgeConfig {
  const origin = env.VERCEL_ENV === "preview" ? canonicalHttpsOrigin(env.WEBSITE_AGENT_ORIGIN) : null;
  return origin
    ? { origin, frameAncestors: `frame-ancestors ${origin}`, xFrameOptions: null }
    : { origin: null, frameAncestors: "frame-ancestors 'none'", xFrameOptions: "DENY" };
}
