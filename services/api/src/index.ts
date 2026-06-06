import { config } from "./config.js";
import { createApp } from "./app.js";
import { logger } from "./logger.js";

const { server } = createApp();

server.listen(config.port, () => {
  logger.info({ port: config.port }, "api_listening");
});
