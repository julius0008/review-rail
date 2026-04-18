import { subscribeToReviewRunEvents } from "@repo/queue";
import type { ReviewRunEvent } from "@repo/shared";
import { sseHeaders, toSseFrame } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let cleanup: (() => Promise<void>) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ReviewRunEvent, includeRetry = false) => {
        if (closed) return;

        try {
          controller.enqueue(toSseFrame(event, includeRetry));
        } catch {
          closed = true;
        }
      };

      const close = async (shouldCloseController = false) => {
        if (closed) return;
        closed = true;

        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        if (cleanup) {
          await cleanup();
          cleanup = null;
        }

        if (shouldCloseController) {
          try {
            controller.close();
          } catch {
            // Ignore repeated or late close attempts during disconnect races.
          }
        }
      };

      request.signal.addEventListener("abort", () => {
        void close(true);
      });

      send(
        {
          type: "connected",
          reviewRunId: "dashboard",
        },
        true
      );

      heartbeat = setInterval(() => {
        send({
          type: "heartbeat",
          reviewRunId: "dashboard",
        });
      }, 25_000);

      cleanup = await subscribeToReviewRunEvents({
        onEvent(event) {
          send(event);
        },
      });
    },
    async cancel() {
      if (!closed) {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        if (cleanup) {
          await cleanup();
          cleanup = null;
        }

        closed = true;
      }
    },
  });

  return new Response(stream, {
    headers: sseHeaders(),
  });
}
