import * as net from 'net';
import { URL } from 'url';

// Function to create the Authorization header
function createAuthHeader(username: string, password: string): string {
    const credentials = `${username}:${password}`;
    const base64Credentials = Buffer.from(credentials).toString('base64');
    return `Basic ${base64Credentials}`;
}

// Function to check if RTSP link is valid
export async function isValidRTSP(urlString: string): Promise<boolean> {
    try {
        // Parse the URL
        const url = new URL(urlString);
        
        // Check if the scheme is 'rtsp'
        if (url.protocol !== 'rtsp:') {
            console.log('Invalid protocol');
            return false;
        }
        console.log(url)
        const host = url.hostname;
        const port = url.port ? parseInt(url.port, 10) : 554;
        const username = url.username;
        const password = url.password;
        const authHeader = username && password ? createAuthHeader(username, password) : null;

        // Create a socket connection
        const socket = new net.Socket();
        const connectPromise = new Promise<void>((resolve, reject) => {
            socket.setTimeout(20_000); // Set a timeout for the connection
            socket.once('connect', resolve);
            socket.once('error', reject);
            socket.connect(port, host);
        });

        await connectPromise;

        // Send RTSP OPTIONS request
        let request = `OPTIONS ${url.pathname} RTSP/1.0\r\nCSeq: 1\r\n`;
        if (authHeader) {
            request += `Authorization: ${authHeader}\r\n`;
        }
        request += `\r\n`;
        socket.write(request);

        // Wait for response and check for validity
        const responsePromise = new Promise<string>((resolve, reject) => {
            let response = '';
            socket.on('data', (chunk) => {
                response += chunk.toString();
                if (response.includes('RTSP/1.0 200 OK')) {
                    resolve(response);
                }
            });
            socket.on('error', reject);
            socket.on('timeout', () => reject(new Error('Socket timeout')));
        });

        const response = await responsePromise;
        socket.destroy();

        if (response.includes('RTSP/1.0 200 OK')) {
            console.log('Valid RTSP response');
            return true;
        } else {
            console.log('Invalid RTSP response');
            return false;
        }

    } catch (error: any) {
        console.error('Error:', error.message);
        return false;
    }
}
