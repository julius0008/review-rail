import type { ReviewRunEvent } from "@repo/shared";

const encoder = new TextEncoder();

export function toSseFrame(event: ReviewRunEvent, includeRetry = false) {
  const prefix = includeRetry ? "retry: 3000\n" : "";
  return encoder.encode(`${prefix}data: ${JSON.stringify(event)}\n\n`);
}

export function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Content-Encoding": "none",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  };
}
