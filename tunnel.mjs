import localtunnel from 'localtunnel';

async function start() {
  try {
    const tunnel = await localtunnel({ port: 5173 });
    console.log('>>> PUBLIC_MOBILE_DEMO_URL:', tunnel.url);
    tunnel.on('close', () => {
      console.log('Tunnel closed, reconnecting...');
      setTimeout(start, 2000);
    });
  } catch (err) {
    console.error('Tunnel error:', err);
    setTimeout(start, 3000);
  }
}

void start();
