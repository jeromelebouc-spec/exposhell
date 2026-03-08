const http = require("http");
const { exec } = require("child_process");

const PORT = 9000;

http.createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";

    req.on("data", chunk => {
      body += chunk.toString();
    });

    req.on("end", () => {
      console.log("Received GitHub webhook");

      exec("/root/exposhell/update.sh", (err, stdout, stderr) => {
        if (err) {
          console.error("Update failed:", err);
        } else {
          console.log("Update complete:", stdout);
        }
      });

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });
  } else {
    res.writeHead(405);
    res.end();
  }
}).listen(PORT, () => {
  console.log(`Webhook listener running on port ${PORT}`);
});
