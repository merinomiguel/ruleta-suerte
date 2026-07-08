const fs = require("fs");
const http = require("http");
const path = require("path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function isInside(baseDir, filePath) {
  const relativePath = path.relative(baseDir, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function resolvePublicFile(publicDir, rawUrl) {
  const rawPath = decodeURIComponent(rawUrl.split("?")[0]);
  const safePath = rawPath === "/" ? "/index.html" : rawPath;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!isInside(publicDir, filePath)) return null;
  return filePath;
}

function createStaticServer(publicDir) {
  return http.createServer((req, res) => {
    if (req.url.split("?")[0] === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    const filePath = resolvePublicFile(publicDir, req.url);
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  });
}

module.exports = { createStaticServer };
