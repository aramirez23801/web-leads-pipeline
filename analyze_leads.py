"""
Deep Analysis: Identify small companies near María de Molina (Madrid)
that are ideal candidates for Private Agentic AI solutions.

Target profile:
- Boutique law firms, small consulting firms, private clinics
- Small banks/financial advisors, accounting firms
- Insurance brokers, notaries, tax advisors
- Architecture studios, real estate agencies
- Any knowledge-worker business that handles confidential data
  and would benefit from local AI (not cloud-dependent)
"""

import pandas as pd
import json
import re

# Load both datasets
df_main = pd.read_excel(r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\businesses_near_maria_de_molina.xlsx')
df_audit = pd.read_excel(r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\leads_audited.xlsx')

# Merge on google_id
df = df_main.merge(
    df_audit[['google_id', 'tier', 'opportunity_score', 'missing_viewport', 'no_ssl',
              'copyright_year', 'outdated_copyright', 'has_dead_tags', 'crawl_error',
              'final_url', 'pitch_angle']],
    on='google_id', how='left'
)

print(f"Total records after merge: {len(df)}")
print(f"Columns: {list(df.columns)}")
print()

# ============================================================
# PHASE 1: Define target categories for Private Agentic AI
# ============================================================
# These are knowledge-worker businesses handling confidential data
# that would benefit from LOCAL AI (privacy-first):
#   - Legal (lawyers, notaries, law firms)
#   - Financial (tax advisors, accountants, financial consultants, banks, insurance)
#   - Consulting (management, HR, IT, marketing, environmental)
#   - Healthcare (clinics, psychologists, dentists, physiotherapy)
#   - Real estate (agencies, consultants, property managers)
#   - Architecture (studios, architects)
#   - Education (private schools, training centers, academies)

# Category mapping: Spanish category -> English label + target segment
TARGET_CATEGORIES = {
    # === LEGAL === (HIGH PRIORITY - handle extremely confidential data)
    'Abogado': ('Lawyer', 'legal', 95),
    'Bufete': ('Law Firm', 'legal', 98),
    'Servicios legales': ('Legal Services', 'legal', 95),
    'Abogado de Derecho de familia': ('Family Lawyer', 'legal', 93),
    'Abogado especialista en derecho de extranjería': ('Immigration Lawyer', 'legal', 93),
    'Abogado penalista': ('Criminal Lawyer', 'legal', 93),
    'Abogado laboralista': ('Labor Lawyer', 'legal', 93),
    'Abogado matrimonialista': ('Divorce Lawyer', 'legal', 93),
    'Abogado administrativo': ('Administrative Lawyer', 'legal', 90),
    'Abogado de lesiones personales': ('Personal Injury Lawyer', 'legal', 90),
    'Abogado de sucesiones': ('Estate Lawyer', 'legal', 93),
    'Abogado civil': ('Civil Lawyer', 'legal', 90),
    'Abogado de patentes': ('Patent Lawyer', 'legal', 95),
    'Abogado especializado en derecho laboral': ('Employment Lawyer', 'legal', 93),
    'Abogado especializado en derecho procesal': ('Procedural Lawyer', 'legal', 90),
    'Abogado especialista en derecho de seguros': ('Insurance Lawyer', 'legal', 93),
    'Abogado especializado en quiebras y concursos': ('Bankruptcy Lawyer', 'legal', 93),
    'General practice attorney': ('General Lawyer', 'legal', 90),
    'Lawyer': ('Lawyer', 'legal', 90),
    'Proveedor de servicios de asistencia jurídica': ('Legal Aid', 'legal', 85),
    'Servicio de búsqueda de abogado': ('Lawyer Referral', 'legal', 70),
    'Notaría': ('Notary', 'legal', 90),
    'Notary public': ('Notary', 'legal', 90),

    # === FINANCIAL === (HIGH PRIORITY - confidential financial data)
    'Asesor fiscal': ('Tax Advisor', 'financial', 95),
    'Gestoría': ('Administrative Agency', 'financial', 90),
    'Gestor': ('Administrative Manager', 'financial', 88),
    'Consultora financiera': ('Financial Consultant', 'financial', 95),
    'Contable': ('Accountant', 'financial', 92),
    'Contador público': ('Public Accountant', 'financial', 92),
    'Empresa de contabilidad': ('Accounting Firm', 'financial', 93),
    'Planificador financiero': ('Financial Planner', 'financial', 95),
    'Banco': ('Bank', 'financial', 85),
    'Servicio de asesoramiento fiscal': ('Tax Advisory', 'financial', 95),
    'Servicio de registros contables': ('Bookkeeping', 'financial', 90),
    'Tax preparation': ('Tax Preparation', 'financial', 92),
    'Asesoría laboral': ('Labor Advisory', 'financial', 90),
    'Tasador': ('Appraiser', 'financial', 80),
    'Desarrollo mercantil': ('Business Development', 'financial', 80),

    # === INSURANCE === (HIGH PRIORITY - sensitive client data)
    'Agencia de seguros': ('Insurance Agency', 'insurance', 90),
    'Corredor de seguros': ('Insurance Broker', 'insurance', 92),
    'Compañía de seguros': ('Insurance Company', 'insurance', 85),
    'Compañía de seguros médicos': ('Health Insurance', 'insurance', 85),
    'Agencia aseguradora de automóviles': ('Auto Insurance', 'insurance', 85),
    'Agencia de seguros de vida': ('Life Insurance', 'insurance', 88),
    'Agence d\'assurance': ('Insurance Agency (FR)', 'insurance', 88),

    # === CONSULTING === (HIGH PRIORITY - client strategy data)
    'Consultora de administración empresarial': ('Management Consultant', 'consulting', 93),
    'Consultora de marketing': ('Marketing Consultant', 'consulting', 88),
    'Consultora informática': ('IT Consultant', 'consulting', 95),
    'Consultoría de recursos humanos': ('HR Consultant', 'consulting', 90),
    'Consultor inmobiliario': ('Real Estate Consultant', 'consulting', 85),
    'Consultor industrial': ('Industrial Consultant', 'consulting', 85),
    'Consultora medioambiental': ('Environmental Consultant', 'consulting', 85),
    'Business management consultant': ('Business Consultant', 'consulting', 90),
    'Computer consultant': ('IT Consultant', 'consulting', 93),
    'Asesor': ('Advisor', 'consulting', 85),
    'Investigador de mercado': ('Market Researcher', 'consulting', 82),
    'Asesor en comercio internacional': ('Intl Trade Advisor', 'consulting', 85),

    # === HEALTHCARE === (HIGH PRIORITY - patient data, GDPR)
    'Psicólogo': ('Psychologist', 'healthcare', 93),
    'Psicoterapeuta': ('Psychotherapist', 'healthcare', 93),
    'Clínica dental': ('Dental Clinic', 'healthcare', 90),
    'Dentista': ('Dentist', 'healthcare', 88),
    'Dental clinic': ('Dental Clinic', 'healthcare', 88),
    'Centro médico': ('Medical Center', 'healthcare', 88),
    'Clínica de fisioterapia': ('Physiotherapy Clinic', 'healthcare', 85),
    'Fisioterapeuta': ('Physiotherapist', 'healthcare', 83),
    'Clínica de oftalmología': ('Ophthalmology Clinic', 'healthcare', 85),
    'Clínica de cirugía plástica': ('Plastic Surgery Clinic', 'healthcare', 85),
    'Clínica especializada': ('Specialized Clinic', 'healthcare', 85),
    'Clínica ambulatoria': ('Outpatient Clinic', 'healthcare', 83),
    'Urólogo': ('Urologist', 'healthcare', 85),
    'Ginecólogo': ('Gynecologist', 'healthcare', 85),
    'Neurólogo': ('Neurologist', 'healthcare', 85),
    'Hospital': ('Hospital', 'healthcare', 60),  # Too big usually
    'Hospital general': ('General Hospital', 'healthcare', 50),
    'Hospital privado': ('Private Hospital', 'healthcare', 65),
    'Hospital infantil': ('Children Hospital', 'healthcare', 55),
    'Hospital universitario': ('University Hospital', 'healthcare', 45),
    'Hospital psiquiátrico': ('Psychiatric Hospital', 'healthcare', 55),
    'Centro de diagnóstico': ('Diagnostic Center', 'healthcare', 80),
    'Médico de urgencias': ('Emergency Doctor', 'healthcare', 60),
    'Servicio de urgencias dentales': ('Dental Emergency', 'healthcare', 70),
    'Farmacia': ('Pharmacy', 'healthcare', 70),

    # === REAL ESTATE === (MEDIUM-HIGH - deal data, client info)
    'Agencia inmobiliaria': ('Real Estate Agency', 'real_estate', 85),
    'Real estate agency': ('Real Estate Agency', 'real_estate', 85),
    'Agentes inmobiliarios': ('Real Estate Agents', 'real_estate', 83),
    'Promotora inmobiliaria': ('Real Estate Developer', 'real_estate', 80),
    'Empresa de administración de propiedades': ('Property Manager', 'real_estate', 83),
    'Agencia inmobiliaria especializada en alquileres': ('Rental Agency', 'real_estate', 80),
    'Registro de la propiedad': ('Property Registry', 'real_estate', 60),

    # === ARCHITECTURE === (MEDIUM-HIGH - project data, IP)
    'Estudio de arquitectura': ('Architecture Studio', 'architecture', 88),
    'Arquitecto': ('Architect', 'architecture', 85),
    'Interiorista': ('Interior Designer', 'architecture', 80),

    # === MARKETING/ADVERTISING === (MEDIUM - client campaign data)
    'Agencia de marketing': ('Marketing Agency', 'marketing', 82),
    'Agencia de publicidad': ('Ad Agency', 'marketing', 80),
    'Marketing agency': ('Marketing Agency', 'marketing', 82),
    'Agence de marketing': ('Marketing Agency (FR)', 'marketing', 80),
    'Servicio de marketing por Internet': ('Digital Marketing', 'marketing', 83),
    'Internet marketing service': ('Digital Marketing', 'marketing', 83),
    'Agencia de branding': ('Branding Agency', 'marketing', 78),
    'Agencia de diseño': ('Design Agency', 'marketing', 78),
    'Diseñador de sitios web': ('Web Designer', 'marketing', 75),
    'Empresa de relaciones públicas': ('PR Firm', 'marketing', 80),
    'Agencia de eCommerce': ('eCommerce Agency', 'marketing', 80),
    'Asesor de prensa': ('Press Advisor', 'marketing', 75),
    'Marketing': ('Marketing', 'marketing', 78),
    'Asesor de imagen': ('Image Consultant', 'marketing', 72),

    # === IT/SOFTWARE === (HIGH - already tech-savvy, understand AI value)
    'Empresa de software': ('Software Company', 'tech', 90),
    'Servicio de informática': ('IT Services', 'tech', 88),
    'Servicio de recuperación de datos': ('Data Recovery', 'tech', 85),
    'Servicio de reparación de ordenadores': ('Computer Repair', 'tech', 70),

    # === CORPORATE/BUSINESS SERVICES ===
    'Oficinas de empresa': ('Corporate Offices', 'business', 80),
    'Corporate office': ('Corporate Office', 'business', 80),
    'Coworking space': ('Coworking', 'business', 65),
    'Espace de coworking': ('Coworking', 'business', 65),
    'Espacio de coworking': ('Coworking', 'business', 65),
    'Centro de negocios': ('Business Center', 'business', 70),
    'Servicios de empresa a empresa': ('B2B Services', 'business', 78),
    'Organizador de eventos': ('Event Organizer', 'business', 68),
    'Empresa de organización de eventos': ('Event Company', 'business', 68),
    'Servicio de mensajería': ('Courier Service', 'business', 60),
    'Agencia de colocación': ('Staffing Agency', 'business', 75),
    'Encargado de contratación': ('Recruiter', 'business', 75),
    'Servicio de seguridad': ('Security Service', 'business', 65),
    'Traductor': ('Translator', 'business', 78),

    # === EDUCATION === (MEDIUM - student data, but less AI urgency)
    'Centro de formación': ('Training Center', 'education', 72),
    'Academia de inglés': ('English Academy', 'education', 70),
    'Academia de idiomas': ('Language Academy', 'education', 70),
    'Servicio de clases particulares': ('Tutoring Service', 'education', 68),
    'Centro educativo': ('Education Center', 'education', 70),
    'Centro de formación profesional': ('Vocational Training', 'education', 72),
    'Academia de informática': ('IT Academy', 'education', 75),
    'Escuela de negocios': ('Business School', 'education', 65),
    'Universidad privada': ('Private University', 'education', 55),
    'Institución educativa': ('Educational Institution', 'education', 60),
}

# ============================================================
# PHASE 2: Classify and Score
# ============================================================

def classify_business(row):
    """Classify a business and compute an AI-need score."""
    cat = row.get('category', '')
    name = str(row.get('name', '')).lower()
    subtypes = str(row.get('subtypes', '')).lower()
    website = str(row.get('website', ''))
    reviews = row.get('reviews', 0) if pd.notna(row.get('reviews')) else 0

    # Check if category is in our targets
    if cat in TARGET_CATEGORIES:
        eng_name, segment, base_score = TARGET_CATEGORIES[cat]
    else:
        # Try partial matching on subtypes
        matched = False
        for target_cat, (eng_name, segment, base_score) in TARGET_CATEGORIES.items():
            tc_lower = target_cat.lower()
            if tc_lower in subtypes:
                matched = True
                break
        if not matched:
            return None, None, 0

    # Adjust score based on signals of being SMALL/BOUTIQUE
    score = base_score

    # Small review count = likely small business (good target)
    if reviews <= 10:
        score += 5
    elif reviews <= 50:
        score += 3
    elif reviews > 200:
        score -= 10  # Likely large/chain

    # Name signals for boutique/small
    boutique_signals = ['despacho', 'bufete', 'gabinete', 'estudio', 'clínica',
                       'clinica', 'consultorio', 'asesoría', 'asesoria',
                       'gestoría', 'gestoria', 'notaría', 'notaria',
                       'boutique', 'privad', 'familiar']
    for signal in boutique_signals:
        if signal in name:
            score += 3
            break

    # Large/chain signals (reduce score)
    chain_signals = ['grupo', 'group', 'internacional', 'international',
                    'bank', 'santander', 'bbva', 'caixabank', 'ibercaja',
                    'mapfre', 'axa', 'allianz', 'generali', 'zurich']
    for signal in chain_signals:
        if signal in name:
            score -= 15
            break

    # Has website = more established, can adopt AI
    if pd.notna(row.get('website')) and str(row['website']).startswith('http'):
        score += 2

    # Cap score
    score = max(0, min(100, score))

    return eng_name, segment, score


# Apply classification
results = df.apply(classify_business, axis=1, result_type='expand')
results.columns = ['eng_category', 'segment', 'ai_need_score']
df = pd.concat([df, results], axis=1)

# Filter to only target businesses
df_targets = df[df['segment'].notna()].copy()
df_targets = df_targets.sort_values('ai_need_score', ascending=False)

print(f"\n{'='*70}")
print(f"TOTAL BUSINESSES: {len(df)}")
print(f"TARGET BUSINESSES (knowledge workers): {len(df_targets)}")
print(f"{'='*70}")

# ============================================================
# PHASE 3: Segment Analysis
# ============================================================
print(f"\n{'='*70}")
print("SEGMENT BREAKDOWN")
print(f"{'='*70}")

segment_stats = df_targets.groupby('segment').agg(
    count=('name', 'count'),
    avg_score=('ai_need_score', 'mean'),
    max_score=('ai_need_score', 'max'),
    has_website=('website', lambda x: x.notna().sum()),
    has_phone=('phone', lambda x: x.notna().sum()),
).sort_values('avg_score', ascending=False)

for seg, row in segment_stats.iterrows():
    pct_web = row['has_website'] / row['count'] * 100
    pct_phone = row['has_phone'] / row['count'] * 100
    print(f"  {seg:15s} | {int(row['count']):4d} leads | avg score: {row['avg_score']:.0f} | "
          f"max: {int(row['max_score'])} | web: {pct_web:.0f}% | phone: {pct_phone:.0f}%")

# ============================================================
# PHASE 4: TOP LEADS - High confidence targets
# ============================================================
# Filter: score >= 85 = HIGH CONFIDENCE
df_high = df_targets[df_targets['ai_need_score'] >= 85].copy()

print(f"\n{'='*70}")
print(f"HIGH CONFIDENCE LEADS (score >= 85): {len(df_high)}")
print(f"{'='*70}")

# Show top leads by segment
for seg in ['legal', 'financial', 'insurance', 'consulting', 'healthcare',
            'real_estate', 'architecture', 'marketing', 'tech', 'business', 'education']:
    seg_df = df_high[df_high['segment'] == seg]
    if len(seg_df) == 0:
        continue
    print(f"\n--- {seg.upper()} ({len(seg_df)} leads) ---")
    for _, r in seg_df.head(15).iterrows():
        name = str(r['name'])[:35]
        cat_en = str(r['eng_category'])[:25]
        phone = str(r.get('phone', 'N/A'))[:18]
        web = str(r.get('website', 'N/A'))[:45]
        score = int(r['ai_need_score'])
        tier = str(r.get('tier', 'N/A'))
        reviews_val = int(r['reviews']) if pd.notna(r.get('reviews')) else 0
        print(f"  [{score:3d}] {name:35s} | {cat_en:25s} | rev:{reviews_val:4d} | {phone:18s} | {tier}")

# ============================================================
# PHASE 5: Export filtered leads
# ============================================================

# Prepare export dataframe
export_cols = ['name', 'eng_category', 'segment', 'ai_need_score', 'category',
               'subtypes', 'phone', 'website', 'rating', 'reviews',
               'postal_code', 'city', 'tier', 'opportunity_score',
               'missing_viewport', 'no_ssl', 'outdated_copyright',
               'pitch_angle', 'query_source', 'google_id']

# Export all targets sorted by score
available_cols = [c for c in export_cols if c in df_targets.columns]
df_export = df_targets[available_cols].sort_values('ai_need_score', ascending=False)

output_path = r'C:\Users\kevin\claudecodeprojects\outscraper-leads\output\filtered_ai_leads.xlsx'

with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
    # Sheet 1: All high-confidence leads
    df_high_export = df_export[df_export['ai_need_score'] >= 85]
    df_high_export.to_excel(writer, sheet_name='High Confidence (85+)', index=False)

    # Sheet 2: Medium confidence
    df_med = df_export[(df_export['ai_need_score'] >= 70) & (df_export['ai_need_score'] < 85)]
    df_med.to_excel(writer, sheet_name='Medium Confidence (70-84)', index=False)

    # Sheet 3: By segment
    for seg in ['legal', 'financial', 'insurance', 'consulting', 'healthcare']:
        seg_df = df_export[df_export['segment'] == seg]
        if len(seg_df) > 0:
            sheet_name = seg.capitalize()[:31]
            seg_df.to_excel(writer, sheet_name=sheet_name, index=False)

    # Sheet 4: All targets
    df_export.to_excel(writer, sheet_name='All Targets', index=False)

print(f"\n{'='*70}")
print(f"EXPORTED: {output_path}")
print(f"  High Confidence (85+): {len(df_high_export)} leads")
print(f"  Medium Confidence (70-84): {len(df_med)} leads")
print(f"  Total Targets: {len(df_export)} leads")
print(f"{'='*70}")

# ============================================================
# PHASE 6: Summary stats
# ============================================================
print(f"\n{'='*70}")
print("WHY THESE BUSINESSES NEED PRIVATE AGENTIC AI")
print(f"{'='*70}")
print("""
1. LEGAL (lawyers, notaries, law firms):
   - Handle attorney-client privileged communications
   - Contract analysis, case research, document drafting
   - CANNOT send client data to cloud AI (ethics rules)
   - LOCAL AI = compliance + efficiency

2. FINANCIAL (tax advisors, accountants, consultants):
   - Client financial records, tax returns, payroll
   - GDPR + Spanish LOPD strict on financial data
   - AI for: automated bookkeeping, tax optimization, report generation

3. INSURANCE (brokers, agencies):
   - Client health data, financial info, claims history
   - AI for: claims processing, risk assessment, policy generation

4. CONSULTING (management, HR, IT):
   - Client strategy documents, competitive intelligence
   - AI for: research analysis, report drafting, proposal generation

5. HEALTHCARE (clinics, psychologists, dentists):
   - Patient medical records (GDPR Art. 9 - special category data)
   - STRICTEST data protection requirements
   - AI for: patient notes, scheduling, diagnosis support

VALUE PROPOSITION: "Your client data never leaves your office.
AI that works ON your computer, not in someone else's cloud."
""")

# Quick stats
has_phone = df_high_export['phone'].notna().sum()
has_web = df_high_export['website'].notna().sum()
print(f"High-confidence leads with phone: {has_phone}/{len(df_high_export)} ({has_phone/len(df_high_export)*100:.0f}%)")
print(f"High-confidence leads with website: {has_web}/{len(df_high_export)} ({has_web/len(df_high_export)*100:.0f}%)")
