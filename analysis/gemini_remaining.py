"""
Score remaining unscored leads across all segments.
Process in batches of 25 to avoid rate limits.
"""

import pandas as pd
import google.generativeai as genai
import json
import time
import re

genai.configure(api_key="AIzaSyAv-y6QvILqlqK4_fijogL8PDhvKr2oAoc")
model = genai.GenerativeModel("gemini-2.0-flash")

# Load current state
df = pd.read_excel(
    r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\final_ai_leads_ranked.xlsx',
    sheet_name='All Ranked'
)

# Get unscored leads
unscored = df[df['priority'].isna()].copy()
print(f"Unscored leads to process: {len(unscored)}")

# Process in batches
BATCH_SIZE = 25
all_results = []

for start in range(0, len(unscored), BATCH_SIZE):
    batch = unscored.iloc[start:start+BATCH_SIZE]

    leads_text = []
    for _, row in batch.iterrows():
        lead = f"Name: {row['name']} | Cat: {row.get('eng_category','')} | Segment: {row.get('segment','')} | Reviews: {int(row['reviews']) if pd.notna(row.get('reviews')) else 0} | Tier: {row.get('tier','')}"
        leads_text.append(lead)

    prompt = f"""Analyze these businesses in Madrid for private local AI sales fit.
Target: small firms handling confidential data needing LOCAL AI (not cloud).

BUSINESSES:
{chr(10).join(leads_text)}

Return ONLY a valid JSON array. Each object:
{{"name":"exact name","size_estimate":"micro/small/medium/large","ai_fit_score":1-10,"reasoning":"one line","priority":"hot/warm/cold"}}

Rules: micro=1-5emp, small=6-20, medium=21-100, large=100+
hot=8-10, warm=5-7, cold=1-4
Named after person = likely micro. International brand = large."""

    for attempt in range(3):
        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            text = re.sub(r'^```(?:json)?\s*', '', text)
            text = re.sub(r'\s*```$', '', text)
            text = text.strip()
            results = json.loads(text)
            all_results.extend(results)
            print(f"  Batch {start//BATCH_SIZE + 1}: scored {len(results)} leads")
            break
        except Exception as e:
            print(f"  Batch {start//BATCH_SIZE + 1}: attempt {attempt+1} failed - {str(e)[:60]}")
            if attempt < 2:
                time.sleep(3)

    time.sleep(1.5)

print(f"\nTotal newly scored: {len(all_results)}")

# Merge back
results_df = pd.DataFrame(all_results)
for _, row in results_df.iterrows():
    mask = df['name'] == row['name']
    if mask.any():
        df.loc[mask, 'size_estimate'] = row['size_estimate']
        df.loc[mask, 'ai_fit_score'] = row['ai_fit_score']
        df.loc[mask, 'reasoning'] = row['reasoning']
        df.loc[mask, 'priority'] = row['priority']

# Recalculate
df['final_score'] = df.apply(
    lambda r: (r['ai_need_score'] * 0.6 + (r['ai_fit_score'] * 10 if pd.notna(r.get('ai_fit_score')) else 0) * 0.4),
    axis=1
)
df = df.sort_values('final_score', ascending=False)

# Final counts
hot = df[df['priority'] == 'hot']
warm = df[df['priority'] == 'warm']
cold = df[df['priority'] == 'cold']
still_unscored = df[df['priority'].isna()]

print(f"\n{'='*80}")
print(f"COMPLETE SCORING RESULTS")
print(f"{'='*80}")
print(f"  HOT:  {len(hot)}")
print(f"  WARM: {len(warm)}")
print(f"  COLD: {len(cold)}")
print(f"  Still unscored: {len(still_unscored)}")

# Print ALL hot leads
print(f"\n{'='*80}")
print(f"ALL HOT LEADS ({len(hot)})")
print(f"{'='*80}")
for seg in ['legal', 'financial', 'insurance', 'consulting', 'healthcare', 'architecture', 'marketing', 'real_estate', 'tech']:
    seg_hot = hot[hot['segment'] == seg]
    if len(seg_hot) == 0:
        continue
    print(f"\n--- {seg.upper()} ({len(seg_hot)}) ---")
    for _, r in seg_hot.iterrows():
        name = str(r['name'])[:42]
        fit = r.get('ai_fit_score', 0)
        size = str(r.get('size_estimate', '?'))[:8]
        phone = str(r.get('phone', 'N/A'))[:18]
        reason = str(r.get('reasoning', ''))[:60]
        print(f"  [{fit:2.0f}/10] {name:42s} | {size:8s} | {phone:18s} | {reason}")

# Export
output_path = r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\final_ai_leads_ranked.xlsx'
with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
    hot.to_excel(writer, sheet_name='HOT Leads', index=False)
    warm.to_excel(writer, sheet_name='WARM Leads', index=False)

    for seg in ['legal', 'financial', 'insurance', 'consulting', 'healthcare', 'architecture', 'marketing', 'real_estate']:
        seg_leads = df[(df['segment'] == seg) & (df['priority'].isin(['hot', 'warm']))].copy()
        if len(seg_leads) > 0:
            seg_leads.to_excel(writer, sheet_name=f'{seg.capitalize()[:20]}', index=False)

    df.to_excel(writer, sheet_name='All Ranked', index=False)

print(f"\nExported to: {output_path}")

# Summary table
print(f"\n{'='*80}")
print(f"{'Segment':15s} | {'HOT':>4s} | {'WARM':>4s} | {'COLD':>4s} | {'Total':>5s}")
print("-" * 50)
for seg in ['legal', 'financial', 'insurance', 'consulting', 'healthcare', 'architecture', 'marketing', 'real_estate', 'tech', 'business']:
    s = df[df['segment'] == seg]
    h = len(s[s['priority'] == 'hot'])
    w = len(s[s['priority'] == 'warm'])
    c = len(s[s['priority'] == 'cold'])
    print(f"{seg:15s} | {h:4d} | {w:4d} | {c:4d} | {len(s):5d}")
total_h = len(hot)
total_w = len(warm)
total_c = len(cold)
print("-" * 50)
print(f"{'TOTAL':15s} | {total_h:4d} | {total_w:4d} | {total_c:4d} | {len(df):5d}")
