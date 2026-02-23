"""
Gemini-powered second pass: validate and re-rank the top leads
for Private Agentic AI sales targeting.
"""

import pandas as pd
import google.generativeai as genai
import json
import time

# Gemini API key
genai.configure(api_key="AIzaSyAv-y6QvILqlqK4_fijogL8PDhvKr2oAoc")
model = genai.GenerativeModel("gemini-2.0-flash")

# Load high-confidence leads
df = pd.read_excel(
    r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\filtered_ai_leads.xlsx',
    sheet_name='High Confidence (85+)'
)

# Prepare batches for Gemini analysis - send top leads from each segment
segments_to_analyze = ['legal', 'financial', 'insurance', 'consulting', 'healthcare', 'architecture']

all_results = []

for segment in segments_to_analyze:
    seg_df = df[df['segment'] == segment].head(30)
    if len(seg_df) == 0:
        continue

    # Prepare lead summaries
    leads_text = []
    for idx, row in seg_df.iterrows():
        lead = {
            'name': str(row['name']),
            'category': str(row.get('eng_category', '')),
            'spanish_category': str(row.get('category', '')),
            'subtypes': str(row.get('subtypes', ''))[:150],
            'reviews': int(row['reviews']) if pd.notna(row.get('reviews')) else 0,
            'rating': float(row['rating']) if pd.notna(row.get('rating')) else 0,
            'website': str(row.get('website', ''))[:80],
            'tier': str(row.get('tier', '')),
            'has_phone': pd.notna(row.get('phone')),
        }
        leads_text.append(json.dumps(lead, ensure_ascii=False))

    prompt = f"""You are a sales intelligence analyst helping identify SMALL/BOUTIQUE businesses
in Madrid (near María de Molina) that would be ideal customers for PRIVATE LOCAL AI solutions.

These businesses handle CONFIDENTIAL data and need AI that runs ON THEIR OWN COMPUTERS
(not cloud-based) for privacy/compliance reasons.

SEGMENT: {segment.upper()}

Here are {len(seg_df)} businesses. For each one, analyze:
1. Is this likely a SMALL/BOUTIQUE firm (1-20 employees) or a LARGE company?
2. How urgently do they need private AI? (confidential data handling)
3. Are they likely tech-savvy enough to adopt AI?
4. Would they have budget for local AI solutions (~2000-5000€)?

Rate each from 1-10 on "ideal customer fit" for private agentic AI.

BUSINESSES:
{chr(10).join(leads_text)}

Return a JSON array with objects containing:
- "name": business name
- "size_estimate": "micro" (1-5), "small" (6-20), "medium" (21-100), "large" (100+)
- "ai_fit_score": 1-10
- "reasoning": one-line explanation
- "priority": "hot" (score 8-10), "warm" (5-7), "cold" (1-4)

IMPORTANT: Return ONLY valid JSON, no markdown formatting.
Focus on identifying the TRUE boutique/small firms that handle confidential data daily."""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()

        # Clean response
        if text.startswith('```'):
            text = text.split('\n', 1)[1]
            if text.endswith('```'):
                text = text[:-3]
            text = text.strip()

        results = json.loads(text)
        for r in results:
            r['segment'] = segment
        all_results.extend(results)
        print(f"  {segment}: analyzed {len(results)} leads")

    except Exception as e:
        print(f"  {segment}: ERROR - {e}")

    time.sleep(1)  # Rate limiting

# Merge Gemini analysis back
print(f"\nTotal Gemini-analyzed leads: {len(all_results)}")

# Create results dataframe
gemini_df = pd.DataFrame(all_results)

# Merge with original data
df_merged = df.merge(gemini_df[['name', 'size_estimate', 'ai_fit_score', 'reasoning', 'priority']],
                     on='name', how='left')

# Final ranking: combine our score with Gemini's
df_merged['final_score'] = df_merged.apply(
    lambda r: (r['ai_need_score'] * 0.6 + (r['ai_fit_score'] * 10 if pd.notna(r.get('ai_fit_score')) else 0) * 0.4),
    axis=1
)

# Sort by final score
df_merged = df_merged.sort_values('final_score', ascending=False)

# Print HOT leads
hot = df_merged[df_merged['priority'] == 'hot']
print(f"\n{'='*80}")
print(f"HOT LEADS (Gemini confirmed high-fit): {len(hot)}")
print(f"{'='*80}")

for seg in segments_to_analyze:
    seg_hot = hot[hot['segment'] == seg]
    if len(seg_hot) == 0:
        continue
    print(f"\n--- {seg.upper()} ({len(seg_hot)} hot leads) ---")
    for _, r in seg_hot.iterrows():
        name = str(r['name'])[:38]
        size = str(r.get('size_estimate', '?'))[:8]
        fit = r.get('ai_fit_score', 0)
        reason = str(r.get('reasoning', ''))[:65]
        phone = str(r.get('phone', 'N/A'))[:18]
        print(f"  [{fit:2.0f}/10] {name:38s} | size: {size:8s} | {phone:18s} | {reason}")

# Export final analysis
output_path = r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\final_ai_leads_ranked.xlsx'
with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
    # Hot leads only
    if len(hot) > 0:
        hot.to_excel(writer, sheet_name='HOT Leads', index=False)

    # Warm leads
    warm = df_merged[df_merged['priority'] == 'warm']
    if len(warm) > 0:
        warm.to_excel(writer, sheet_name='WARM Leads', index=False)

    # All merged
    df_merged.to_excel(writer, sheet_name='All Ranked', index=False)

print(f"\n{'='*80}")
print(f"FINAL EXPORT: {output_path}")
print(f"  HOT leads: {len(hot)}")
print(f"  WARM leads: {len(warm) if 'warm' in dir() else 0}")
print(f"  Total analyzed: {len(df_merged)}")
print(f"{'='*80}")
