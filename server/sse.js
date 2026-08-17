const clients = new Set();

function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(': connected\n\n');

  clients.add(res);

  const keepalive = setInterval(() => {
    if (!clients.has(res)) {
      clearInterval(keepalive);
      return;
    }
    try {
      res.write(': keepalive\n\n');
    } catch (err) {
      clients.delete(res);
      clearInterval(keepalive);
    }
  }, 30000);

  req.on('close', () => {
    clients.delete(res);
    clearInterval(keepalive);
  });
}

function broadcast(eventName, data) {
  const message = `event: ${eventName}\ndata: ${data}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch (err) {
      clients.delete(client);
    }
  }
}

module.exports = { addClient, broadcast };
