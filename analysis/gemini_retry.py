"""
Retry the failed Gemini segments (financial, insurance, healthcare)
with stronger JSON formatting instructions.
"""

import pandas as pd
import google.generativeai as genai
import json
import time
import re

genai.configure(api_key="AIzaSyAv-y6QvILqlqK4_fijogL8PDhvKr2oAoc")
model = genai.GenerativeModel("gemini-2.0-flash")

df = pd.read_excel(
    r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\filtered_ai_leads.xlsx',
    sheet_name='High Confidence (85+)'
)

# Load existing results
existing_df = pd.read_excel(
    r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\final_ai_leads_ranked.xlsx',
    sheet_name='All Ranked'
)

segments_to_retry = ['financial', 'insurance', 'healthcare']
all_results = []

for segment in segments_to_retry:
    seg_df = df[df['segment'] == segment].head(30)
    if len(seg_df) == 0:
        continue

    leads_text = []
    for idx, row in seg_df.iterrows():
        lead = f"Name: {row['name']} | Cat: {row.get('eng_category','')} | Reviews: {int(row['reviews']) if pd.notna(row.get('reviews')) else 0} | Tier: {row.get('tier','')}"
        leads_text.append(lead)

    prompt = f"""Analyze these {segment.upper()} businesses in Madrid for private AI sales fit.
Target: small firms handling confidential data that need LOCAL AI (not cloud).

BUSINESSES:
{chr(10).join(leads_text)}

For each, return JSON. ONLY output a valid JSON array, nothing else.
Each object: {{"name":"...", "size_estimate":"micro/small/medium/large", "ai_fit_score":1-10, "reasoning":"one line", "priority":"hot/warm/cold"}}

Rules:
- micro=1-5 employees, small=6-20, medium=21-100, large=100+
- hot=score 8-10 (perfect fit), warm=5-7 (good potential), cold=1-4 (skip)
- Boutique law/accounting/medical firms with <50 reviews are usually small
- Named after a person = likely micro/small
- Big brand names or international firms = usually large, score lower"""

    for attempt in range(3):
        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            # Clean markdown fences
            text = re.sub(r'^```(?:json)?\s*', '', text)
            text = re.sub(r'\s*```$', '', text)
            text = text.strip()

            results = json.loads(text)
            for r in results:
                r['segment'] = segment
            all_results.extend(results)
            print(f"  {segment}: analyzed {len(results)} leads (attempt {attempt+1})")
            break
        except Exception as e:
            print(f"  {segment}: attempt {attempt+1} failed - {e}")
            if attempt < 2:
                time.sleep(2)

    time.sleep(1)

print(f"\nRetried segments: {len(all_results)} leads analyzed")

# Merge retry results
retry_df = pd.DataFrame(all_results)

# Update existing data
for _, row in retry_df.iterrows():
    mask = existing_df['name'] == row['name']
    if mask.any():
        existing_df.loc[mask, 'size_estimate'] = row['size_estimate']
        existing_df.loc[mask, 'ai_fit_score'] = row['ai_fit_score']
        existing_df.loc[mask, 'reasoning'] = row['reasoning']
        existing_df.loc[mask, 'priority'] = row['priority']

# Recalculate final score
existing_df['final_score'] = existing_df.apply(
    lambda r: (r['ai_need_score'] * 0.6 + (r['ai_fit_score'] * 10 if pd.notna(r.get('ai_fit_score')) else 0) * 0.4),
    axis=1
)

existing_df = existing_df.sort_values('final_score', ascending=False)

# Print ALL hot leads now
hot = existing_df[existing_df['priority'] == 'hot']
warm = existing_df[existing_df['priority'] == 'warm']

print(f"\n{'='*80}")
print(f"COMBINED HOT LEADS: {len(hot)}")
print(f"{'='*80}")

for seg in ['legal', 'financial', 'insurance', 'consulting', 'healthcare', 'architecture']:
    seg_hot = hot[hot['segment'] == seg]
    if len(seg_hot) == 0:
        continue
    print(f"\n--- {seg.upper()} ({len(seg_hot)} hot leads) ---")
    for _, r in seg_hot.iterrows():
        name = str(r['name'])[:40]
        size = str(r.get('size_estimate', '?'))[:8]
        fit = r.get('ai_fit_score', 0)
        reason = str(r.get('reasoning', ''))[:70]
        phone = str(r.get('phone', 'N/A'))[:18]
        print(f"  [{fit:2.0f}/10] {name:40s} | {size:8s} | {phone:18s} | {reason}")

# Final export
output_path = r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\final_ai_leads_ranked.xlsx'
with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
    hot.to_excel(writer, sheet_name='HOT Leads', index=False)
    warm.to_excel(writer, sheet_name='WARM Leads', index=False)

    # By segment sheets for HOT + WARM
    for seg in ['legal', 'financial', 'insurance', 'consulting', 'healthcare', 'architecture', 'marketing', 'real_estate']:
        seg_leads = existing_df[(existing_df['segment'] == seg) & (existing_df['priority'].isin(['hot', 'warm']))].copy()
        if len(seg_leads) > 0:
            seg_leads.to_excel(writer, sheet_name=f'{seg.capitalize()[:20]}', index=False)

    existing_df.to_excel(writer, sheet_name='All Ranked', index=False)

print(f"\n{'='*80}")
print(f"FINAL EXPORT: {output_path}")
print(f"  HOT leads: {len(hot)}")
print(f"  WARM leads: {len(warm)}")
print(f"  COLD leads: {len(existing_df[existing_df['priority'] == 'cold'])}")
print(f"  Unscored: {len(existing_df[existing_df['priority'].isna()])}")
print(f"{'='*80}")

# Print summary table
print(f"\n{'='*80}")
print("FINAL SUMMARY BY SEGMENT")
print(f"{'='*80}")
print(f"{'Segment':15s} | {'HOT':>4s} | {'WARM':>4s} | {'COLD':>4s} | {'Unscored':>8s} | {'Total':>5s}")
print("-" * 60)
for seg in ['legal', 'financial', 'insurance', 'consulting', 'healthcare', 'architecture', 'marketing', 'real_estate', 'tech', 'business', 'education']:
    s = existing_df[existing_df['segment'] == seg]
    h = len(s[s['priority'] == 'hot'])
    w = len(s[s['priority'] == 'warm'])
    c = len(s[s['priority'] == 'cold'])
    u = len(s[s['priority'].isna()])
    print(f"{seg:15s} | {h:4d} | {w:4d} | {c:4d} | {u:8d} | {len(s):5d}")
