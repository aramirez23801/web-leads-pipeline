# Cold Email Sending Domain — Detailed Setup (Per Website)
**Date:** 2026-03-02
**Total cost:** ~€25-30/year + €1/month for email

---

## Website 1: Porkbun.com — Register the domain

Porkbun is the cheapest major .com registrar. About $9.73/year first year.

1. Go to **porkbun.com**
2. Search for your domain. Suggestions (in order of preference):
   - `hola-mejoraweb.com` — sounds human, clearly related
   - `contacto-mejoraweb.com`
   - `mejoraweb-hola.com`
   - Avoid: `mejoraweb.com` (too close to main brand), random-looking names
3. Add to cart → Create account → Pay. No upsells needed.
4. After purchase, go to **Account → Domain Management → your domain → DNS**. Leave this tab open — you'll come back to add records in Step 3.

**Why not Namecheap?** Porkbun is cheaper and has a cleaner DNS editor. Either works.
**Why not a .es domain?** .es domains require a Spanish NIF/CIF for registration. Doable but adds friction. .com is fine for this use case.

---

## Website 2: Zoho Mail — Set up the mailbox

Zoho Mail Lite is €1/month (billed annually = €12/year). This is the cheapest option that gives you real SMTP/IMAP access, which you need to connect to the warmup tool.

1. Go to **zoho.com/mail** → click "Business Email" → choose **Mail Lite** (€1/user/month)
2. On the setup screen, select "I have a domain already" → enter your new domain
3. Zoho will give you a **domain verification TXT record**. Copy it — looks like:
   ```
   Type: TXT
   Name: @
   Value: zoho-verification=zb00000000.zmverify.zoho.eu
   ```
4. Go back to your Porkbun DNS tab. Click "Add Record":
   - Type: `TXT`
   - Host: leave blank (or `@`)
   - Answer: paste the `zoho-verification=...` value
   - TTL: 600
   - Save
5. Back in Zoho: click "Verify TXT Record" (may take 5-10 min to propagate)
6. Once verified, create your mailbox:
   - Username: `andres` (gives you `andres@hola-mejoraweb.com`)
   - Set a strong password, save it somewhere
7. Zoho will also show you **MX records** to add. Add all of them in Porkbun DNS:
   ```
   Type: MX   Host: @   Priority: 10   Answer: mx.zoho.eu
   Type: MX   Host: @   Priority: 20   Answer: mx2.zoho.eu
   Type: MX   Host: @   Priority: 50   Answer: mx3.zoho.eu
   ```

Test the mailbox works: log in at **mail.zoho.com** with your new email and password. Send yourself a test email to your personal account. If it arrives, the mailbox is working.

---

## Website 3: Porkbun DNS (again) — Add SPF, DKIM, DMARC

Go back to your Porkbun DNS editor. You'll add three records. Do them one at a time.

### Record 1: SPF
Tells other servers that Zoho is allowed to send email from your domain.

```
Type:   TXT
Host:   (leave blank)
Answer: v=spf1 include:zoho.eu ~all
TTL:    3600
```
Click Save.

### Record 2: DKIM
This one requires going to Zoho first to generate the key.

**In Zoho Mail Admin:**
1. Go to **mail.zoho.com** → click the grid icon (top right) → **Admin Console**
2. Left menu: **Email Configuration → DKIM**
3. Select your domain → click **Add Selector**
4. Selector name: `zoho1` (or leave default)
5. Key size: **2048 bit** (more secure)
6. Click Generate — Zoho shows you the TXT record values:
   ```
   Selector: zoho1
   TXT Name: zoho1._domainkey
   TXT Value: v=DKIM1; k=rsa; p=MIIBIjANBgkqhki...(long key)
   ```
7. Copy the full value exactly.

**Back in Porkbun DNS:**
```
Type:   TXT
Host:   zoho1._domainkey
Answer: v=DKIM1; k=rsa; p=MIIBIjAN...(paste full key)
TTL:    3600
```
Click Save.

**Back in Zoho Admin → DKIM:** click **Verify** next to your selector. It should turn green. If not, wait 15 min and try again.

### Record 3: DMARC
Tells receiving servers what to do if SPF or DKIM fail. Start with `p=none` (monitor only — safe, no email blocked).

```
Type:   TXT
Host:   _dmarc
Answer: v=DMARC1; p=none; rua=mailto:andres@mejoraweb.app; pct=100
TTL:    3600
```

Replace `andres@mejoraweb.app` with your real personal email — DMARC reports will land there (weekly XML digests, mostly ignorable at this stage).

---

## Website 4: mail-tester.com — Verify everything is set up correctly

1. Go to **mail-tester.com** — it shows you a unique test address like `test-abc123@srv1.mail-tester.com`
2. In Zoho Mail, compose a new email:
   - To: the test address from mail-tester.com
   - Subject: anything (e.g. "Test")
   - Body: write 3-4 lines of normal text (not just "test" — blank/short emails can hurt the score)
3. Send it
4. Back on mail-tester.com, click "Then check your score"

**Target: 8/10 or higher before proceeding.** Common issues and fixes:

| Score issue | Fix |
|---|---|
| SPF not found | Check the SPF TXT record in Porkbun — no typos, Host field blank/@ |
| DKIM invalid | In Zoho DKIM settings, re-verify. Check the Host field in Porkbun is exactly `zoho1._domainkey` |
| No DMARC record | Double-check Host is `_dmarc` (with underscore) |
| Low spam score | Write a proper email body, not just "test" |

Wait up to 1 hour after adding DNS records before testing — propagation can be slow.

---

## Website 5: Instantly.ai — Connect mailbox and start warmup

Instantly.ai is $37/month and includes unlimited email warmup accounts. You need this for V2 anyway (it's your sending platform), so it makes sense to start the subscription now and use the 4-6 week wait to both warm up the mailbox AND finish building your pipeline stages.

1. Go to **instantly.ai** → Sign up → choose the **Growth plan** ($37/month)
   - If you want to test first: they have a 7-day trial. Start the trial, connect your mailbox, and decide before it ends.
2. Go to **Email Accounts → Add Account → Connect via SMTP**
   - SMTP host: `smtp.zoho.eu`
   - SMTP port: `465` (SSL) or `587` (TLS)
   - SMTP username: `andres@hola-mejoraweb.com`
   - SMTP password: your Zoho password

   **Important:** Zoho may block SMTP login unless you generate an App Password.
   In Zoho Mail → Account Settings → Security → App Passwords → Create new → name it "Instantly" → copy the generated password → use that in Instantly instead of your regular password.

   - IMAP host: `imap.zoho.eu`
   - IMAP port: `993`
   - IMAP username + password: same as above

3. Click Connect → Instantly will test the connection. If it fails, double-check the App Password.
4. Once connected, go to the account settings and enable **Email Warmup**:
   - Daily warmup limit: **10 emails/day** (week 1-2)
   - Reply rate: 35-40%
   - Leave all other settings default
5. Click Save. Warmup starts automatically — Instantly's network begins exchanging emails with your account and marking them as important/not-spam.

**What to check weekly:** In Instantly → Email Accounts → your account → Warmup Stats. You'll see inbox placement % rising week over week. Target 85%+ before sending real cold email.

---

## Warmup schedule

| Week | Daily limit | What to do |
|------|------------|------------|
| 1-2 | 10/day | Do nothing. Let it run. |
| 3-4 | 25/day | Increase limit in Instantly account settings |
| 5-6 | 50/day | Check inbox placement stats |
| After 6 weeks | 50-80/day real sends | Run deliverability test, then first campaign |

During these 6 weeks you'll finish building stages 8-10, run the v2 re-scrape, and test the full pipeline. The timing works out perfectly.

---

## Full checklist

- [ ] Domain registered at Porkbun
- [ ] Zoho Mail Lite account created, domain verified, MX records added
- [ ] Mailbox created and sends/receives email
- [ ] SPF record added in Porkbun DNS
- [ ] DKIM generated in Zoho Admin, added in Porkbun DNS, verified in Zoho
- [ ] DMARC record added in Porkbun DNS
- [ ] mail-tester.com score ≥ 8/10
- [ ] Zoho App Password generated
- [ ] Instantly.ai account created
- [ ] Mailbox connected via SMTP/IMAP in Instantly
- [ ] Warmup enabled at 10/day
- [ ] ⏳ 4-6 weeks
