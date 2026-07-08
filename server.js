const path = require("path");
const { createStaticServer } = require("./src/server/static-server");
const { attachRealtimeServer } = require("./src/server/realtime");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const server = createStaticServer(PUBLIC_DIR);
attachRealtimeServer(server);

server.listen(PORT, () => {
  console.log(`La Ruleta de la Suerte online: http://localhost:${PORT}`);
});
