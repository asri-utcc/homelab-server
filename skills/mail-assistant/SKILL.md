---
name: mail-assistant
description: Inspect and triage emails from asri.utcc@gmail.com using the dedicated IMAP Python script and secure App Password storage.
---

# Mail Assistant Skill

This skill allows querying, summarizing, and monitoring incoming emails from the user's Gmail account.

## Configuration & Tooling
- **Script:** `/home/dev/projects/check-mail.py`
- **Credentials:** `/home/dev/projects/.gmail.env` (`chmod 600`, user `dev` only)
- **Account:** `asri.utcc@gmail.com` (App Password via IMAP SSL on port 993)

## Usage
1. **Check Recent / Today's Emails:**
   ```bash
   python3 /home/dev/projects/check-mail.py [limit]
   ```
2. **Retrieve Verification/OTP Codes (e.g. Xiaomi, Security Alerts):**
   - Parse subject or snippet to extract 6-digit confirmation codes.
3. **Safety Constraints:**
   - Script runs in readonly mode (`INBOX` select readonly). Never delete or alter emails.
