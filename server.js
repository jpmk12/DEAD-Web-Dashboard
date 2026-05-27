// Custom server entry point for GoDaddy / Phusion Passenger (cPanel "Setup Node.js App").
//
// Passenger starts THIS file and assigns a port via process.env.PORT. It hooks
// into the .listen() call of the HTTP server created here. Running `next start`
// directly doesn't work reliably under Passenger because its listening socket
// isn't created in this main process — hence the "listening on the wrong port"
// error. Creating the server here and calling .listen(process.env.PORT) fixes it.
//
// In cPanel → Setup Node.js App, set "Application startup file" to: server.js

// The platform may inject a non-standard NODE_ENV, which makes Next/React use
// their development runtimes. Force production so the served app uses the
// production runtime (and so NODE_ENV-based flags like secure cookies are correct).
if (process.env.NODE_ENV !== "production") process.env.NODE_ENV = "production";

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

const port = process.env.PORT || 3000;
// Bind to 0.0.0.0 (all IPv4 interfaces) so the platform's proxy can reach the
// app. Without an explicit host, Node binds to IPv6 "::" which a proxy that
// connects over IPv4 127.0.0.1 may not reach — the app runs but appears "down".
const host = process.env.HOST || "0.0.0.0";
const app = next({ dev: false });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => {
      handle(req, res, parse(req.url, true));
    }).listen(port, host, () => {
      console.log(`> Ready on http://${host}:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start Next.js server:", err);
    process.exit(1);
  });
