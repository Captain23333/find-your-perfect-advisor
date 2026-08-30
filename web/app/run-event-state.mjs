export function appendVisibleRunEvent(current, event, limit = 400) {
  const previous = current[current.length - 1];
  if (
    event.type === "item/agentMessage/delta" &&
    previous?.type === event.type &&
    previous.source === event.source
  ) {
    return [
      ...current.slice(0, -1),
      {
        ...previous,
        message: `${previous.message || ""}${event.message || ""}`,
      },
    ];
  }

  // A provider can print the same transient MCP/HTTP failure many times. Keep
  // only the latest counted warning so retries do not crowd out real progress.
  if (event.type === "connection.retry") {
    const withoutOlderRetries = current.filter(
      (item) => item.type !== "connection.retry",
    );
    return [...withoutOlderRetries.slice(-(limit - 1)), event];
  }

  return [...current.slice(-(limit - 1)), event];
}
