import { connectToWhatsApp } from '../lib/client.js';
import chalk from 'chalk';
import ora from 'ora';

export async function login() {
    console.log(chalk.blue('Initialize WhatsApp Session'));
    
    try {
        const spinner = ora('Connecting to WhatsApp...').start();
        
        await new Promise((resolve, reject) => {
            connectToWhatsApp((update) => {
                const { connection, qr } = update;
                
                if (qr) {
                    spinner.stop();
                    // QR is handled in client.js, but we need to pause spinner
                }
                
                if (connection === 'open') {
                    spinner.succeed('Connected to WhatsApp');
                    console.log(chalk.green('Session saved. You can now use other commands.'));
                    resolve();
                }
                
                if (connection === 'close') {
                    // Start spinner again if we are reconnecting
                    if (!spinner.isSpinning) spinner.start('Reconnecting...');
                }
            }).catch(reject);
        });

        // Force exit after successful login to prevent hanging
        process.exit(0);

    } catch (error) {
        console.error(chalk.red('Login failed:'), error);
        process.exit(1);
    }
}



