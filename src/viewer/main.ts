import { createServer } from "vite";
import config from "./vite.config.js";

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] !== undefined && !/^\d+$/.test(args[0])))
  throw new Error("Использование: npm run viewer -- [port]");
const port = args[0] === undefined ? 4173 : Number(args[0]);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Порт должен быть от 1 до 65535");
const server = await createServer({
  ...config,
  configFile: false,
  server: { ...config.server, port },
});
await server.listen();
server.printUrls();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void server.close();
  });
