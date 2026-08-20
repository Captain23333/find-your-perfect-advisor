// Classification is driven by the structured source first (which stream a line
// came from, which protocol type it is). The regexes only exist to catch
// providers that still print human-readable noise, so swapping a provider
// degrades to "unclassified diagnostic" rather than leaking internals into the
// main progress log.
export const RUN_EVENT_LEVELS = [
  "progress",
  "warning",
  "action_required",
  "error",
  "diagnostic",
];

const PROVIDER_NOISE_PATTERN =
  /Reading additional input from stdin|codex_core_plugins::manifest|codex_core_skills::loader|failed to load models cache|failed to renew cache TTL|Unknown model .*fallback model metadata|model personality requested|ignoring interface\.[a-z_]+|state db discrepancy|token count|telemetry/i;

const CONNECTION_RETRY_PATTERN =
  /MCP[^\n]*(initialize|connect|handshake)[^\n]*(fail|error|timeout)|HTTP 5\d\d|ECONNRESET|ETIMEDOUT|socket hang up|stream (error|disconnected)|retry(ing)? in|reconnect/i;

export function classifyProviderLine(provider, line, stream) {
  if (stream !== "stderr") return "progress";
  if (CONNECTION_RETRY_PATTERN.test(line)) return "connection_retry";
  if (PROVIDER_NOISE_PATTERN.test(line)) return "diagnostic";
  if (/\b(error|panic|fatal)\b/i.test(line)) return "error";
  // Anything else on stderr is still internal plumbing, not user-facing progress.
  return "diagnostic";
}
