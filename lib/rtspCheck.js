const net = require('net');
const { URL } = require('url');
const crypto = require('crypto');

function isPrivateIP(hostname) {
  if (!hostname) return false;
  const ip = hostname.trim();
  if (ip === 'localhost' || ip === '127.0.0.1') return true;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function generateDigestResponse(username, password, realm, nonce, uri) {
  const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`DESCRIBE:${uri}`).digest('hex');
  return crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
}

function checkRtspLink(rtspUrl, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 5000;

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(rtspUrl);
    } catch (e) {
      resolve({ ok: false, code: 'INVALID_URL', message: 'Invalid RTSP URL' });
      return;
    }

    if (!parsed.protocol || !parsed.protocol.toLowerCase().startsWith('rtsp')) {
      resolve({ ok: false, code: 'INVALID_PROTOCOL', message: 'Invalid protocol. Must be RTSP.' });
      return;
    }

    const hostname = parsed.hostname;
    if (!hostname) {
      resolve({ ok: false, code: 'INVALID_URL', message: 'Missing hostname' });
      return;
    }

    if (isPrivateIP(hostname)) {
      resolve({ ok: false, code: 'PRIVATE_IP', message: 'RTSP URL resolves to a private/local IP; use a public IP and ensure port forwarding.' });
      return;
    }

    const host = hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : 554;
    const username = parsed.username || '';
    const password = parsed.password || '';

    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    let response = '';
    let authAttempted = false;

    function sendRequest(authHeader) {
      const cseq = authAttempted ? '2' : '1';
      const headerPart = authHeader ? authHeader : '';
      const request = `DESCRIBE ${rtspUrl} RTSP/1.0\r\n` +
                      `CSeq: ${cseq}\r\n` +
                      `User-Agent: Fry-Registration/1.0\r\n` +
                      `Accept: application/sdp\r\n` +
                      headerPart +
                      '\r\n';
      socket.write(request);
    }

    socket.connect(port, host, () => sendRequest());

    socket.on('data', (data) => {
      response += data.toString();

      if (response.includes('RTSP/1.0 200 OK')) {
        socket.destroy();
        resolve({ ok: true, host, port });
        return;
      }

      if (response.includes('RTSP/1.0 401 Unauthorized') && !authAttempted) {
        const lines = response.split('\n').map((l) => l.trim());
        const wwwAuthHeaders = lines.filter((line) => line.startsWith('WWW-Authenticate:'));
        const digestHeader = wwwAuthHeaders.find((h) => h.includes('Digest'));
        const realmMatch = digestHeader && digestHeader.match(/realm="([^"]+)"/);
        const nonceMatch = digestHeader && digestHeader.match(/nonce="([^"]+)"/);
        const realm = realmMatch && realmMatch[1];
        const nonce = nonceMatch && nonceMatch[1];

        if (realm && nonce && username && password) {
          const digestResponse = generateDigestResponse(username, password, realm, nonce, rtspUrl);
          const authHeader = `Authorization: Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${rtspUrl}", response="${digestResponse}"\r\n`;
          authAttempted = true;
          response = '';
          sendRequest(authHeader);
          return;
        }
      }

      // Not OK and not a handled auth flow
      socket.destroy();
      resolve({ ok: false, code: 'RTSP_ERROR', message: 'Unexpected RTSP response', host, port });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, code: 'ETIMEDOUT', message: 'Connection timed out', host, port });
    });

    socket.on('error', (err) => {
      socket.destroy();
      const code = (err && err.code) || 'UNKNOWN_ERROR';
      resolve({ ok: false, code, message: String((err && err.message) || err), host, port });
    });

    socket.on('close', () => {
      if (!response.includes('RTSP/1.0 200 OK')) {
        resolve({ ok: false, code: 'CLOSED', message: 'Connection closed before OK', host, port });
      }
    });
  });
}

module.exports = {
  checkRtspLink,
  default: checkRtspLink,
};
