// api/src/functions/proxy.js
const { app } = require("@azure/functions");
const { createProxyMiddleware } = require("http-proxy-middleware");

const target = "http://localhost:7071";

const proxy = createProxyMiddleware({
  target,
  changeOrigin: true,
  logLevel: "silent",
});

app.http("webApiProxy", {
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: async (req, context) => {
    // no-op: this file is just to signal we will proxy via Vite instead (next step)
    return { status: 404, jsonBody: { ok: false } };
  },
});
