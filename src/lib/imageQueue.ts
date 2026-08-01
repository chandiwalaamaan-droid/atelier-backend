import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { createPostgresBackend } from "bullmq/postgres";
import type { PostgresConnectionOptions } from "bullmq/postgres";

export type ImageGenJobData = {
  prompt: string;
  isExplicit: boolean;
  kind: "avatar" | "background";
};

export type ImageGenJobResult = {
  bytes: Buffer;
  provider: string;
};

export type ImageGenJobReturn = {
  jobId: string;
  promise: Promise<ImageGenJobResult>;
};

const QUEUE_NAME = "image-generation";
const WORKER_CONCURRENCY = Number(process.env.IMAGE_GEN_WORKER_CONCURRENCY || "4");
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required for BullMQ Postgres backend");
}

const connection: PostgresConnectionOptions = DATABASE_URL;

let queue: Queue | null = null;
let worker: Worker | null = null;
let queueEvents: QueueEvents | null = null;

export function getImageGenQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: connection as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: {
          count: 100,
          age: 60 * 60,
        },
        removeOnFail: {
          count: 200,
          age: 24 * 60 * 60,
        },
      },
    });
  }
  return queue;
}

export function getOrCreateQueueEvents(): QueueEvents {
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, {
      connection: connection as any,
    });
  }
  return queueEvents;
}

export function createImageGenWorker(
  processor: (job: Job) => Promise<ImageGenJobResult>,
): Worker {
  if (!worker) {
    worker = new Worker(QUEUE_NAME, processor, {
      connection: connection as any,
      concurrency: WORKER_CONCURRENCY,
    });
    worker.on("failed", (job, err) => {
      console.error(`[image-queue] Job ${job?.id} failed:`, err);
    });
  }
  return worker;
}

export async function enqueueImageGen(data: ImageGenJobData): Promise<ImageGenJobReturn> {
  const q = getImageGenQueue();
  const jobId = `${data.kind}:${Buffer.from(data.prompt).toString("base64url")}`;
  const job = await q.add("generate", data, {
    jobId,
    removeOnComplete: false,
  });
  const queueEvents = getOrCreateQueueEvents();
  return {
    jobId: job.id!,
    promise: job.waitUntilFinished(queueEvents).then((result: any) => result as ImageGenJobResult),
  };
}

export async function closeImageGenQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
