import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-api-token",
      "req.headers.x-session-token"
    ],
    censor: "[redacted]"
  }
});
