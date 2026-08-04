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

const MAX_CONCURRENT = Number(process.env.IMAGE_GEN_WORKER_CONCURRENCY || "4");
const MAX_WAIT_MS = Number(process.env.IMAGE_GEN_WAIT_TIMEOUT_MS || "60000");
const MAX_QUEUE_DEPTH = Number(process.env.IMAGE_GEN_MAX_QUEUE_DEPTH || "50");

let active = 0;
// Each waiter carries its own timeout handle so release() can clear it
// when it resolves the waiter normally, instead of leaving a dangling
// timer running (and holding the event loop open) until it fires later
// and does a pointless no-op reject/splice against an already-settled
// promise.
const waiters: { resolve: () => void; timer: ReturnType<typeof setTimeout> }[] = [];

async function acquire(): Promise<void> {
  if (waiters.length >= MAX_QUEUE_DEPTH) {
    throw new Error(
      `Image generation queue is full (${MAX_QUEUE_DEPTH} requests waiting). ` +
      `Please try again in a moment.`
    );
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (active >= MAX_CONCURRENT) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Image generation is busy and the wait timed out after ${MAX_WAIT_MS / 1000}s. ` +
        `Please try again.`
      );
    }
    await new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        timer: setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(
            `Image generation wait timed out after ${MAX_WAIT_MS / 1000}s. Please try again.`
          ));
        }, remaining),
      };
      waiters.push(entry);
    });
  }
  active += 1;
}

function release(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  }
}

export async function acquireImageGenSlot(): Promise<void> {
  await acquire();
}

export function releaseImageGenSlot(): void {
  release();
}

export function startImageGenWorker(): void {
  console.log(
    `[image-queue] Using in-memory queue ` +
    `(concurrency=${MAX_CONCURRENT}, maxWait=${MAX_WAIT_MS}ms, maxQueueDepth=${MAX_QUEUE_DEPTH})`
  );
}

export async function closeImageGenQueue(): Promise<void> {
  const errors: Error[] = [];
  for (const entry of waiters.splice(0)) {
    try {
      clearTimeout(entry.timer);
      entry.resolve();
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  if (errors.length > 0) {
    console.error(`[image-queue] Drained ${errors.length} waiters on shutdown`);
  }
}
