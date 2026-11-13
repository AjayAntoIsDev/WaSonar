import { connectToWhatsApp } from '../lib/client.js';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { checkAuth, sleep } from '../lib/utils.js';
import ora from 'ora';

export async function devices(number, options) {
    checkAuth();
    console.log(chalk.blue(`Getting devices for: ${number}`));
    
    try {
        const connectSpinner = ora('Connecting to WhatsApp...').start();
        const sock = await connectToWhatsApp();
        
        // Wait for connection
        await new Promise(resolve => {
            if (sock.ws.isOpen) return resolve();
            sock.ev.on('connection.update', (u) => {
                if (u.connection === 'open') resolve();
            });
        });
        connectSpinner.succeed('Connected to WhatsApp');

        const deviceSpinner = ora('Querying device list...').start();
        const rawJid = jidNormalizedUser(`${number}@s.whatsapp.net`);
        const [exists] = await sock.onWhatsApp(rawJid);
        const jid = exists?.exists ? exists.jid : rawJid;
        const devicesList = await sock.getUSyncDevices([jid], false, false);

        if (!Array.isArray(devicesList)) {
            deviceSpinner.fail('Failed to retrieve device list.');
            process.exit(1);
        }

        const devices = devicesList.map(d => ({
            jid: d.jid,
            deviceId: d.device,
            isMain: d.device === 0,
            label: d.device === 0 ? 'Phone' : `Companion ${d.device}`,
            online: null
        })).sort((a, b) => (a.isMain ? -1 : 1));

        deviceSpinner.succeed(`Found ${devices.length} linked device(s)`);

        // Check online status if --no-online is NOT passed
        if (options.online) {
            const onlineSpinner = ora('Checking online status...').start();
            
            // Probe all devices in parallel
            const probeResults = await Promise.all(
                devices.map(d => {
                    const probeJid = d.deviceId === 0 && !d.jid.includes(':') ? d.jid.replace('@', ':0@') : d.jid;
                    return sendProbe(sock, probeJid);
                })
            );

            // Attach results
            devices.forEach((d, i) => {
                d.online = probeResults[i].clientRtt !== null;
                d.rtt = probeResults[i].clientRtt;
            });
            
            onlineSpinner.succeed('Online check complete');
        }

        console.log('');
        
        devices.forEach((d, i) => {
            const type = d.isMain ? 'Main Device (Phone)' : 'Companion Device';
            let statusStr = '';
            if (options.online) {
                statusStr = d.online 
                    ? chalk.green(` ONLINE (${d.rtt}ms)`) 
                    : chalk.gray(' OFFLINE');
            }
            console.log(`Device ${i + 1} [${type}]${statusStr}`);
            console.log(chalk.dim(`   JID: ${d.jid}`));
            console.log(chalk.dim(`   ID:  ${d.deviceId}\n`));
        });

        if (options.output) {
            if (!fs.existsSync(options.output)) fs.mkdirSync(options.output, { recursive: true });
            const filePath = path.join(options.output, `devices-${number}.json`);
            fs.writeFileSync(filePath, JSON.stringify(devices, null, 2));
            console.log(chalk.cyan(`Results saved to: ${filePath}`));
        }

        process.exit(0);

    } catch (error) {
        console.error(chalk.red('Error fetching devices:'), error);
        process.exit(1);
    }
}

// Inline probe function
async function sendProbe(sock, targetJid) {
    const startTime = Date.now();
    const fakeId = `PROBE_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const fakeKey = { remoteJid: targetJid, fromMe: true, id: fakeId };

    let clientAckTime = null;
    let resolved = false;
    let deleteMessageId = null;

    const getStatus = (s) => {
        if (typeof s === 'number') return s;
        if (s === 'SERVER_ACK') return 2;
        if (s === 'DELIVERY_ACK') return 3;
        if (s === 'READ') return 4;
        return 0;
    };

    const updateHandler = (updates) => {
        if (resolved) return;
        for (const u of updates) {
            if (deleteMessageId && u.key.id === deleteMessageId) {
                const status = getStatus(u.update.status);
                if (status >= 3 && !clientAckTime) {
                    clientAckTime = Date.now();
                    resolved = true;
                }
            }
        }
    };

    const upsertHandler = (event) => {
        if (resolved) return;
        const msg = event.messages?.[0];
        if (!msg) return;
        const isRevoke = msg.message?.protocolMessage?.type === 'REVOKE' || msg.message?.protocolMessage?.type === 0;
        const targetId = msg.message?.protocolMessage?.key?.id;
        if (msg.key.fromMe && isRevoke && targetId === fakeId) {
            if (!deleteMessageId) deleteMessageId = msg.key.id;
            const status = getStatus(msg.status);
            if (status >= 3 && !clientAckTime) {
                clientAckTime = Date.now();
                resolved = true;
            }
        }
    };

    sock.ev.on('messages.update', updateHandler);
    sock.ev.on('messages.upsert', upsertHandler);

    try {
        const sent = await sock.sendMessage(targetJid, { delete: fakeKey });
        if (sent?.key?.id) deleteMessageId = sent.key.id;

        const waitStart = Date.now();
        while (!resolved && (Date.now() - waitStart) < 5000) {
            await sleep(50);
        }
    } catch (e) {
        sock.ev.off('messages.update', updateHandler);
        sock.ev.off('messages.upsert', upsertHandler);
        return { error: e.message };
    }

    sock.ev.off('messages.update', updateHandler);
    sock.ev.off('messages.upsert', upsertHandler);

    return {
        timestamp: startTime,
        clientRtt: clientAckTime ? (clientAckTime - startTime) : null
    };
}




