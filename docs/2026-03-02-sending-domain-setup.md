# Cold Email Sending Domain — Setup Guide
**Date:** 2026-03-02
**Lead time:** 4-6 weeks before you can send cold email
**Start this now — it runs in the background while you finish the pipeline.**

---

## Why you need a separate domain

Never use `mejoraweb.app` for cold email. One spam complaint or bounce-rate spike can
blacklist your main domain and destroy your brand's email reputation permanently.
A separate sending domain protects `mejoraweb.app` no matter what happens.

---

## Step 1 — Choose and register the sending domain

**Recommended naming pattern:** something that sounds human and related to your brand,
but is clearly not your main site. Examples:
- `hola-mejoraweb.com` (~€10/year)
- `contacto-mejoraweb.es` (~€8/year)
- `mejoraweb-team.com` (~€10/year)

**Avoid:**
- Exact match to your brand (`mejoraweb.com`) — too valuable to risk
- Random/spammy-looking names (`xn9234leads.com`) — low trust

**Where to register:**
- Namecheap (recommended — cheap, good DNS editor)
- Porkbun (cheapest .com registrar currently)
- Squarespace Domains (clean UI if you prefer)

**Register it now.** You don't need to set up anything on it yet, but the sooner you
register, the sooner you can start aging the domain (older domains = better deliverability).

---

## Step 2 — Set up email hosting

You need real mailboxes on the domain to send from. Two options:

### Option A: Google Workspace (recommended, $6/month per mailbox)
Best deliverability. Instantly.ai and Smartlead have native Google OAuth integration.

1. Go to workspace.google.com → Start free trial
2. Enter your new sending domain when asked
3. Verify domain ownership: Google will give you a TXT record to add in your DNS
   - In your registrar's DNS panel, add: `TXT @ "google-site-verification=XXXX"`
4. Create mailbox: e.g., `andres@hola-mejoraweb.com`
5. Wait ~15 min for propagation, then log in and confirm the mailbox works

### Option B: Zoho Mail (free for up to 5 users)
Acceptable, slightly lower deliverability than Google. Good enough for testing.

1. Go to zoho.com/mail → Free plan
2. Add your domain
3. Verify ownership with a TXT record
4. Create mailbox

**How many mailboxes?**
Start with 1-2 per domain. Each mailbox sends max 30-50 emails/day during warmup,
scaling to 100-150/day after warmup. For 30 leads/neighborhood, 1 mailbox is enough.

---

## Step 3 — Configure DNS records

In your registrar's DNS panel, add these three records. All three are required for
good deliverability and to avoid spam folders.

### Record 1: SPF (Sender Policy Framework)
Tells receiving servers which IPs are allowed to send email for your domain.

**If using Google Workspace:**
```
Type: TXT
Name: @  (or leave blank, means root domain)
Value: v=spf1 include:_spf.google.com ~all
TTL: 3600
```

**If using Zoho:**
```
Type: TXT
Name: @
Value: v=spf1 include:zoho.eu ~all
TTL: 3600
```

### Record 2: DKIM (DomainKeys Identified Mail)
A cryptographic signature that proves emails actually came from you.

**Google Workspace:**
1. In Google Admin Console → Apps → Google Workspace → Gmail → Authenticate email
2. Click "Generate new record" → Select 2048-bit key
3. Google gives you a TXT record like:
   ```
   Type: TXT
   Name: google._domainkey
   Value: v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0....(long key)....
   ```
4. Add exactly as shown in your DNS panel
5. Back in Google Admin → click "Start authentication"

**Zoho:**
Similar process under Settings → Email Authentication → DKIM

### Record 3: DMARC (Domain-based Message Authentication)
Tells receiving servers what to do if SPF/DKIM checks fail. Start with `p=none`
(monitor-only), then tighten after warmup.

```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:andres@mejoraweb.app; pct=100
TTL: 3600
```

- `p=none` = monitor but don't reject (safe starting point)
- `rua=` = where to send aggregate reports (use your real email address)
- After warmup, change to `p=quarantine`, then eventually `p=reject`

---

## Step 4 — Verify your setup

After adding DNS records, wait 30-60 minutes for propagation, then test:

1. **mail-tester.com** — Send an email from your new mailbox to the test address shown.
   Score should be 8+/10 before starting warmup.
2. **MXToolbox SPF checker:** `mxtoolbox.com/spf.aspx` — paste your domain
3. **MXToolbox DKIM checker:** `mxtoolbox.com/dkim.aspx`
4. **DMARC analyzer:** `dmarcanalyzer.com` or `easydmarc.com/tools/dmarc-lookup`

All three should show green/pass before proceeding.

---

## Step 5 — Connect to Instantly.ai and start warmup

1. Sign up at instantly.ai (~$37/month — try the trial first)
2. Go to Email Accounts → Add Account
3. Connect your Google Workspace mailbox via OAuth (recommended) or SMTP credentials
4. Instantly automatically adds your account to their warmup pool (Unibox)
5. Warmup settings (start conservative):
   - Daily send limit: 10 emails/day (week 1-2)
   - Increase by 5-10/day each week
   - Max warmup: 50-80/day
6. Enable "Warmup" toggle — Instantly starts exchanging emails within their network

**What warmup does:** Sends real emails between accounts in the network and marks
them as "Not Spam" if they land in junk. Builds your domain's sending reputation
gradually so real cold emails land in inbox.

**Do not send any cold email during warmup.** Just let it run.

---

## Step 6 — Wait (4-6 weeks)

During warmup, domain reputation is being built. You'll see:
- Week 1-2: Low volume, some emails may land in promotions tab
- Week 3-4: Volume increasing, deliverability improving
- Week 5-6: 80-90% inbox placement (check in Instantly dashboard)

Use this time to finish building stages 8-10 of the pipeline.

---

## Step 7 — Verify deliverability before first send

1. In Instantly → Email Accounts → your account → click "Test deliverability"
2. Should show Inbox (not Spam/Promotions) for Gmail and Outlook
3. Run mail-tester.com again from the warmed-up account — still score 8+/10?
4. Only send real leads when deliverability test shows Inbox placement

---

## Step 8 — First campaign settings (conservative)

When deliverability is confirmed:
- Max 20-30 emails/day on the first week of real sends
- Only Tier 1 and high-score Tier 2 leads in the first batch
- Plain text only (no images, no HTML, no attachments in email 1)
- Include preview link in email 1 body — NOT a PDF attachment
- Monitor reply rate for first 30 sends before scaling up

---

## Legal requirements (Spain B2B — LSSI + GDPR)

For cold email to **business email addresses** (info@, contacto@, hola@) with a
genuine commercial reason, legitimate interest applies under LSSI + GDPR. Required:

1. Your company name and address in every email (footer)
2. Unsubscribe instruction in every email: "Para darse de baja, responda a este correo con 'baja'"
3. Honor unsubscribes within 10 days
4. Do NOT email personal addresses (personal Gmail, etc.) — these require prior consent
5. Do NOT email non-business addresses scraped from social media

The Outscraper domains_service scrapes emails from business websites (info@, contact@, etc.)
which qualifies as B2B business addresses. This is the correct use case.

---

## Summary checklist

- [ ] Domain registered (e.g., `hola-mejoraweb.com`)
- [ ] Google Workspace or Zoho mailbox created
- [ ] SPF record added
- [ ] DKIM record generated and added
- [ ] DMARC record added (`p=none` to start)
- [ ] mail-tester.com score ≥ 8/10
- [ ] Instantly.ai account set up
- [ ] Mailbox connected to Instantly
- [ ] Warmup enabled and running
- [ ] ⏳ Wait 4-6 weeks
- [ ] Deliverability test passes (Inbox placement)
- [ ] First campaign at limited volume (20-30/day)
