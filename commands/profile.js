import { connectToWhatsApp } from '../lib/client.js';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import chalk from 'chalk';
import { checkAuth } from '../lib/utils.js';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import https from 'https';

export async function profile(number, options) {
    checkAuth();
    console.log(chalk.blue(`Fetching profile for: ${number}`));
    
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

        const profileSpinner = ora('Fetching profile info...').start();
        const jid = jidNormalizedUser(`${number}@s.whatsapp.net`);

        // Check if number exists on WhatsApp
        const [exists] = await sock.onWhatsApp(jid);
        if (!exists || !exists.exists) {
            profileSpinner.fail('Number not found on WhatsApp');
            process.exit(1);
        }

        // Fetch status/about
        let status = null;
        try {
            const statusResult = await sock.fetchStatus(jid);
            status = statusResult?.status || null;
        } catch (e) {
            // Status might be private
        }

        // Fetch profile picture URL
        let profilePicUrl = null;
        try {
            profilePicUrl = await sock.profilePictureUrl(jid, 'image');
        } catch (e) {
            // Profile pic might be private
        }

        profileSpinner.succeed('Profile fetched');
        console.log('');

        // Display profile
        console.log(chalk.white.bold('Profile Information'));
        console.log(chalk.dim('─'.repeat(40)));
        console.log(`${chalk.cyan('Number:')}   ${number}`);
        console.log(`${chalk.cyan('JID:')}      ${exists.jid}`);
        console.log(`${chalk.cyan('Status:')}   ${status || chalk.gray('(private/not set)')}`);
        console.log(`${chalk.cyan('Picture:')}  ${profilePicUrl ? 'Available' : chalk.gray('(private/not set)')}`);

        if (profilePicUrl) {
            console.log(chalk.dim(`           ${profilePicUrl}`));
        }

        // Save to output if specified
        if (options.output) {
            if (!fs.existsSync(options.output)) fs.mkdirSync(options.output, { recursive: true });
            
            const profileData = {
                number,
                jid: exists.jid,
                status,
                profilePicUrl,
                fetchedAt: new Date().toISOString()
            };

            // Save JSON
            const jsonPath = path.join(options.output, `profile-${number}.json`);
            fs.writeFileSync(jsonPath, JSON.stringify(profileData, null, 2));
            console.log(chalk.cyan(`\nProfile data saved to: ${jsonPath}`));

            // Download profile picture if available
            if (profilePicUrl) {
                const picSpinner = ora('Downloading profile picture...').start();
                const picPath = path.join(options.output, `profile-${number}.jpg`);
                
                try {
                    await downloadFile(profilePicUrl, picPath);
                    picSpinner.succeed(`Profile picture saved to: ${picPath}`);
                } catch (e) {
                    picSpinner.fail('Failed to download profile picture');
                }
            }
        }

        process.exit(0);

    } catch (error) {
        console.error(chalk.red('Error fetching profile:'), error);
        process.exit(1);
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                https.get(response.headers.location, (res) => {
                    res.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }).on('error', reject);
            } else {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }
        }).on('error', reject);
    });
}

