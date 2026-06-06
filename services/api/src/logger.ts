import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "api" },
  timestamp: pino.stdTimeFunctions.isoTime
});
