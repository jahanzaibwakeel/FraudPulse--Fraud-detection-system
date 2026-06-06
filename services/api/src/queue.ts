import { Queue } from "bullmq";
import { config } from "./config.js";

const valkey = new URL(config.valkeyUrl);
const connection = {
  host: valkey.hostname,
  port: Number(valkey.port || 6379),
  password: valkey.password || undefined,
  maxRetriesPerRequest: null
};

export const scoringQueue = new Queue("score-transactions", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
});
