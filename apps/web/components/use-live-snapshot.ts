"use client";

import { startTransition, useEffect, useEffectEvent, useState } from "react";
import type { ReviewRunEvent } from "@repo/shared";

export type LiveConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling";

type Options<T> = {
  initialData: T;
  fetchUrl: string;
  streamUrl: string;
  pollIntervalMs: number;
  shouldContinuePolling?: (data: T) => boolean;
};

async function fetchSnapshot<T>(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function useLiveSnapshot<T>({
  initialData,
  fetchUrl,
  streamUrl,
  pollIntervalMs,
  shouldContinuePolling,
}: Options<T>) {
  const [data, setData] = useState(initialData);
  const [connectionState, setConnectionState] =
    useState<LiveConnectionState>("connecting");

  const refresh = useEffectEvent(async () => {
    const nextSnapshot = await fetchSnapshot<T>(fetchUrl);
    startTransition(() => {
      setData(nextSnapshot);
    });
    return nextSnapshot;
  });

  const canKeepPolling = useEffectEvent((snapshot: T) =>
    shouldContinuePolling ? shouldContinuePolling(snapshot) : true
  );

  useEffect(() => {
    let isDisposed = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let pollTimer: number | null = null;
    let reconnectAttempts = 0;
    let usingPolling = false;

    const stopPolling = () => {
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (usingPolling || isDisposed) return;

      usingPolling = true;
      setConnectionState("polling");

      pollTimer = window.setInterval(() => {
        if (document.visibilityState === "hidden") {
          return;
        }

        void refresh().then((nextSnapshot) => {
          if (!canKeepPolling(nextSnapshot)) {
            stopPolling();
          }
        });
      }, pollIntervalMs);
    };

    const connect = () => {
      if (isDisposed) return;

      if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
        startPolling();
        return;
      }

      setConnectionState(reconnectAttempts === 0 ? "connecting" : "reconnecting");
      eventSource = new EventSource(streamUrl);

      eventSource.onopen = () => {
        reconnectAttempts = 0;
        setConnectionState("live");
      };

      eventSource.onmessage = (message) => {
        let event: ReviewRunEvent;

        try {
          event = JSON.parse(message.data) as ReviewRunEvent;
        } catch {
          return;
        }

        if (event.type === "connected" || event.type === "heartbeat") {
          return;
        }

        void refresh();
      };

      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        reconnectAttempts += 1;
        setConnectionState("reconnecting");

        if (reconnectAttempts >= 3) {
          startPolling();
          return;
        }

        reconnectTimer = window.setTimeout(() => {
          connect();
        }, 3000);
      };
    };

    connect();

    return () => {
      isDisposed = true;

      if (eventSource) {
        eventSource.close();
      }

      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }

      stopPolling();
    };
  }, [fetchUrl, pollIntervalMs, streamUrl]);

  return {
    data,
    connectionState,
  };
}
