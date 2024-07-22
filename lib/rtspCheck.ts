import * as net from 'net';
import * as url from 'url';
import * as crypto from 'crypto';

function generateDigestResponse(username: string, password: string, realm: string, nonce: string, uri: string): string {
  const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`DESCRIBE:${uri}`).digest('hex');
  return crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
}

export function checkRtspLink(rtspUrl: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(rtspUrl);

    if (!parsedUrl.protocol || parsedUrl.protocol.toLowerCase() !== 'rtsp:') {
      reject(new Error('Invalid protocol. Must be RTSP.'));
      return;
    }

    if (!parsedUrl.hostname) {
      reject(new Error('Invalid URL. Missing hostname.'));
      return;
    }

    const host = parsedUrl.hostname;
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 554;
    
    const auth = parsedUrl.auth ? parsedUrl.auth.split(':') : [];
    const username = auth[0] || '';
    const password = auth[1] || '';

    const socket = new net.Socket();
    socket.setTimeout(5000); // 5 seconds timeout

    let authAttempted = false;

    function sendRequest(authHeader = '') {
      const cseq = authAttempted ? '2' : '1';
      const request = `DESCRIBE ${rtspUrl} RTSP/1.0\r\n` +
                      `CSeq: ${cseq}\r\n` +
                      `User-Agent: LibVLC/3.0.8 (LIVE555 Streaming Media v2018.02.18)\r\n` +
                      `Accept: application/sdp\r\n` +
                      `x-sessioncookie: 31df7d10b7ba43f0\r\n` +
                      authHeader +
                      '\r\n';
      console.log('Sending request:');
      console.log(request);
      socket.write(request);
    }

    socket.connect(port, host, () => {
      sendRequest();
    });

    let response = '';

    socket.on('data', (data) => {
      response += data.toString();
      console.log('Received response:');
      console.log(response);

      if (response.includes('RTSP/1.0 200 OK')) {
        socket.destroy();
        resolve(true);
      } else if (response.includes('RTSP/1.0 401 Unauthorized') && !authAttempted) {
        const wwwAuthHeaders = response.split('\n').filter(line => line.startsWith('WWW-Authenticate:'));
        const digestHeader = wwwAuthHeaders.find(header => header.includes('Digest'));
        const realm = digestHeader?.match(/realm="([^"]+)"/)?.[1];
        const nonce = digestHeader?.match(/nonce="([^"]+)"/)?.[1];
        
        if (realm && nonce && username && password) {
          const digestResponse = generateDigestResponse(username, password, realm, nonce, rtspUrl);
          const authHeader = `Authorization: Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${rtspUrl}", response="${digestResponse}"\r\n`;
          authAttempted = true;
          response = '';
          sendRequest(authHeader);
        } else {
          socket.destroy();
          resolve(false);
        }
      } else {
        socket.destroy();
        resolve(false);
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timed out'));
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
      socket.destroy();
      reject(err);
    });

    socket.on('close', () => {
      if (!response.includes('RTSP/1.0 200 OK')) {
        resolve(false);
      }
    });
  });
}