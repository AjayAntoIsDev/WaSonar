import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';

const logger = pino({ level: 'silent' }); // Silent to keep CLI clean

// Suppress libsignal session logs
const originalConsoleInfo = console.info;
console.info = function (...args) {
    const message = args.join(' ');
    if (message.includes('Closing session') ||
        message.includes('Opening session') ||
        message.includes('Migrating session') ||
        message.includes('Removing old closed session')) {
        return;
    }
    originalConsoleInfo.apply(console, args);
};

const originalConsoleWarn = console.warn;
console.warn = function (...args) {
    const message = args.join(' ');
    if (message.includes('Decrypted message with closed session') ||
        message.includes('Closing open session in favor of incoming prekey bundle') ||
        message.includes('Session already closed') ||
        message.includes('Session already open')) {
        return;
    }
    originalConsoleWarn.apply(console, args);
};

const originalConsoleError = console.error;
console.error = function (...args) {
    const message = args.map(a => (a && a.stack) ? a.stack : String(a)).join(' ');
    if (message.includes('Failed to decrypt message with any known session') ||
        message.includes('Session error:') ||
        message.includes('Bad MAC')) {
        return;
    }
    originalConsoleError.apply(console, args);
};

export async function connectToWhatsApp(onUpdate) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (onUpdate) {
            onUpdate(update, sock);
        }

        if (qr) {
            console.log(chalk.cyan('Scan this QR code to login:'));
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                // Reconnect loop... pass onUpdate so caller still receives events from the new socket
                connectToWhatsApp(onUpdate); 
            } else {
                console.log(chalk.red('Connection closed. You are logged out.'));
            }
        } else if (connection === 'open') {
            // Connection open - commands handle their own feedback
        }
    });

    return sock;
}



