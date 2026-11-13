import { connectToWhatsApp } from '../lib/client.js';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import chalk from 'chalk';
import { checkAuth, sleep } from '../lib/utils.js';
import fs from 'fs';
import path from 'path';
import ora from 'ora';

export async function online(number, options) {
    checkAuth();
    console.log(chalk.blue(`Checking online status for: ${number}`));
    
    const maxProbes = parseInt(options.probes, 10);
    const infinite = maxProbes === 0;

    if (infinite) {
        console.log(chalk.yellow(`Mode: Infinite Probes (Ctrl+C to stop)`));
    } else {
        console.log(chalk.yellow(`Mode: ${maxProbes} Probe(s)`));
    }

    try {
        // Connect with spinner
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

        // Fetch devices with spinner
        const rawJid = jidNormalizedUser(`${number}@s.whatsapp.net`);
        const deviceSpinner = ora('Fetching linked devices...').start();
        const [exists] = await sock.onWhatsApp(rawJid);
        const mainJid = exists?.exists ? exists.jid : rawJid;
        const devicesList = await sock.getUSyncDevices([mainJid], false, false);

        if (!Array.isArray(devicesList) || devicesList.length === 0) {
            deviceSpinner.fail('No devices found for this number.');
            process.exit(1);
        }

        const devices = devicesList.map(d => ({
            jid: d.jid,
            deviceId: d.device,
            isMain: d.device === 0,
            label: d.device === 0 ? 'Phone' : `Companion ${d.device}`
        }));

        deviceSpinner.succeed(`Found ${devices.length} device(s)`);
        console.log(chalk.dim('─'.repeat(60)));

        
        let probeCount = 0;
        const allResults = [];

        // Main Loop
        while (infinite || probeCount < maxProbes) {
            probeCount++;
            console.log(chalk.cyan(`\n[Probe ${probeCount}]`));

            // Create spinner
            const spinner = ora({ text: 'Probing all devices...', spinner: 'dots' }).start();

            // Send probes in PARALLEL
            const probePromises = devices.map(device => {
                const probeJid = device.deviceId === 0 && !device.jid.includes(':') ? device.jid.replace('@', ':0@') : device.jid;
                return sendProbe(sock, probeJid).then(result => ({ ...result, device: device.label }));
            });

            const results = await Promise.all(probePromises);
            spinner.stop();

            // Display results
            for (const result of results) {
                process.stdout.write(`  ${result.device.padEnd(15)}: `);
                if (result.error) {
                    console.log(chalk.red(`Error - ${result.error}`));
                } else {
                    const isOnline = result.clientRtt !== null;
                    const status = isOnline 
                        ? chalk.green('ONLINE') 
                        : chalk.gray('OFFLINE');
                    
                    const clientTime = result.clientRtt ? `${result.clientRtt}ms` : '-';
                    console.log(`${status} (${clientTime})`);
                }
                allResults.push(result);
            }

            if (options.output) {
                saveResults(number, allResults, options.output);
            }

            await sleep(1000);
        }

        console.log(chalk.blue('\nProbing finished.'));
        process.exit(0);

    } catch (error) {
        console.error(chalk.red('Error in online check:'), error);
        process.exit(1);
    }
}



async function sendProbe(sock, targetJid) {
    const startTime = Date.now();
    
    // Generate fake message ID (the one we're "deleting")
    const fakeId = `PROBE_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const fakeKey = {
        remoteJid: targetJid,
        fromMe: true,
        id: fakeId
    };

    let serverAckTime = null;
    let clientAckTime = null;
    let resolved = false;
    let deleteMessageId = null; // The ACTUAL message ID of the delete request

    // Helper: Normalize status
    const getStatus = (s) => {
        if (typeof s === 'number') return s;
        if (s === 'SERVER_ACK') return 2;
        if (s === 'DELIVERY_ACK') return 3;
        if (s === 'READ') return 4;
        return 0;
    };

    // Listener: Update (tracks the DELETE message ID)
    const updateHandler = (updates) => {
        if (resolved) return;
        for (const u of updates) {
            // Match against the actual delete message ID, not the fake one
            if (deleteMessageId && u.key.id === deleteMessageId) {
                const rawStatus = u.update.status;
                const status = getStatus(rawStatus);
                
                if (status === 2 && !serverAckTime) {
                    serverAckTime = Date.now();
                }
                if (status >= 3 && !clientAckTime) {
                    clientAckTime = Date.now();
                    resolved = true;
                }
            }
        }
    };

    // Listener: Upsert (Catches the REVOKE message itself)
    const upsertHandler = (event) => {
        if (resolved) return;
        const msg = event.messages?.[0];
        if (!msg) return;

        // Check if it's our own REVOKE message
        const isRevoke = msg.message?.protocolMessage?.type === 'REVOKE' || 
                         msg.message?.protocolMessage?.type === 0;
        const targetId = msg.message?.protocolMessage?.key?.id;

        if (msg.key.fromMe && isRevoke && targetId === fakeId) {
            // Capture the real delete message ID
            if (!deleteMessageId) {
                deleteMessageId = msg.key.id;
            }

            const rawStatus = msg.status;
            const status = getStatus(rawStatus);

            if (status === 2 && !serverAckTime) {
                serverAckTime = Date.now();
            }
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
        
        // Capture the delete message ID from the response
        if (sent?.key?.id) {
            deleteMessageId = sent.key.id;
        }

        // Record server RTT from sendMessage completion if not already set
        if (!serverAckTime) {
            serverAckTime = Date.now();
        }

        // Wait for delivery ack (up to 5 seconds)
        const waitStart = Date.now();
        while (!resolved && (Date.now() - waitStart) < 5000) {
            await sleep(50);
        }

    } catch (e) {
        console.error(chalk.red('Send error:'), e);
        sock.ev.off('messages.update', updateHandler);
        sock.ev.off('messages.upsert', upsertHandler);
        return { error: e.message };
    }

    sock.ev.off('messages.update', updateHandler);
    sock.ev.off('messages.upsert', upsertHandler);

    return {
        timestamp: startTime,
        serverRtt: serverAckTime ? (serverAckTime - startTime) : null,
        clientRtt: clientAckTime ? (clientAckTime - startTime) : null
    };
}



function saveResults(number, results, dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, `online-rtt-${number}.json`), 
        JSON.stringify(results, null, 2)
    );
}
