import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./dist/public", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safePath(urlPath) {
  const pathname = decodeURIComponent((urlPath || "/").split("?")[0]);
  const candidate = resolve(root, `.${pathname}`);
  return candidate.startsWith(root) ? candidate : null;
}

const server = createServer((request, response) => {
  const requested = safePath(request.url);
  const file = requested && existsSync(requested) && statSync(requested).isFile() ? requested : join(root, "index.html");
  response.statusCode = 200;
  response.setHeader("Content-Type", types[extname(file).toLowerCase()] || "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(file).on("error", () => {
    response.statusCode = 500;
    response.end("Falha ao ler o arquivo do editor.");
  }).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Modela 3D offline disponível em http://127.0.0.1:${port}`);
  console.log("Pressione Ctrl+C para encerrar.");
});
