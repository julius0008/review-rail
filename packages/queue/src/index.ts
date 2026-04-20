import { Queue } from "bullmq";
import RedisModule, {
  type Redis as RedisClientType,
  type RedisOptions,
} from "ioredis";
import { prisma } from "@repo/db";
import type { ReviewJob } from "@repo/shared";
import {
  getAppConfig,
  getReviewRunEventsChannel,
  REVIEW_RUN_EVENTS_CHANNEL,
  reviewRunEventSchema,
  type ReviewRunEvent,
  type ReviewRunEventType,
} from "@repo/shared";

const RedisCtor = RedisModule as unknown as new (
  url: string,
  options: RedisOptions
) => RedisClientType;

let sharedConnection: RedisClientType | null = null;
let sharedQueue: Queue<ReviewJob> | null = null;
let eventPublisher: RedisClientType | null = null;

function createRedisClient() {
  const config = getAppConfig();

  return new RedisCtor(config.redisUrl, {
    maxRetriesPerRequest: null,
    ...(config.redis.useTls ? { tls: {} } : {}),
  }) as unknown as RedisClientType;
}

export function getRedisConnection() {
  if (!sharedConnection) {
    sharedConnection = createRedisClient();
  }

  return sharedConnection as unknown as any;
}

export function getReviewQueue() {
  if (!sharedQueue) {
    sharedQueue = new Queue("review-pr", {
      connection: getRedisConnection(),
    }) as unknown as Queue<ReviewJob>;
  }

  return sharedQueue;
}

function getEventPublisher() {
  if (!eventPublisher) {
    eventPublisher = getRedisConnection().duplicate() as unknown as RedisClientType;
  }

  return eventPublisher;
}

function serializeEvent(event: ReviewRunEvent) {
  return JSON.stringify(reviewRunEventSchema.parse(event));
}

export async function publishReviewRunEvent(event: ReviewRunEvent) {
  const payload = serializeEvent(event);
  const publisher = getEventPublisher();

  await publisher.publish(REVIEW_RUN_EVENTS_CHANNEL, payload);
  await publisher.publish(getReviewRunEventsChannel(event.reviewRunId), payload);
}

export async function emitAfterRunUpdate(
  reviewRunId: string,
  type: Extract<ReviewRunEventType, "run_created" | "run_updated"> = "run_updated"
) {
  const run = await prisma.reviewRun.findUnique({
    where: { id: reviewRunId },
    select: {
      id: true,
      repoId: true,
      prNumber: true,
      status: true,
      llmStatus: true,
      publishState: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!run) return;

  await publishReviewRunEvent({
    type,
    reviewRunId: run.id,
    repoId: run.repoId,
    prNumber: run.prNumber,
    status: run.status as ReviewRunEvent["status"],
    llmStatus: run.llmStatus as ReviewRunEvent["llmStatus"],
    publishState: run.publishState as ReviewRunEvent["publishState"],
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  });
}

export async function subscribeToReviewRunEvents(input: {
  reviewRunId?: string;
  onEvent: (event: ReviewRunEvent) => void;
}) {
  const subscriber = getRedisConnection().duplicate() as unknown as RedisClientType;
  const channels = input.reviewRunId
    ? [getReviewRunEventsChannel(input.reviewRunId)]
    : [REVIEW_RUN_EVENTS_CHANNEL];

  const handleMessage = (_channel: string, message: string) => {
    try {
      input.onEvent(reviewRunEventSchema.parse(JSON.parse(message)));
    } catch {
      // Ignore malformed events so one bad payload does not tear down the stream.
    }
  };

  subscriber.on("message", handleMessage);
  await subscriber.subscribe(...channels);

  return async () => {
    subscriber.off("message", handleMessage);
    await subscriber.unsubscribe(...channels);
    await subscriber.quit();
  };
}
