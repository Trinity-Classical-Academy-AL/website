#!/usr/bin/env python3
"""
Convert the exported proforma workbook into the JSON that scripts/finance/import-proforma.mjs writes.

    python -I scripts/finance/proforma-to-json.py <proforma.xlsx> <out.json>

Needs openpyxl. The workbook and the JSON hold named salaries: keep both OUTSIDE the repo.

Each sheet formula is read once here and turned into a visible rule (flat, per student,
per faculty, % of tuition...). The mapping and the fixes to the sheet are in
docs/superpowers/specs/2026-11-23-finances-proforma-design.md. Defaults for the open questions
(docs/superpowers/specs/2026-11-23-finance-STATUS.md): carry Year 1 fixed costs into Years 2/3,
bank fee 2%, family discounts $18,400, tuition assistance $23,900, CHOOSE Act kept as an
education expense where the sheet has it.
"""
import json
import os
import re
import sys

import openpyxl

if len(sys.argv) != 3:
    sys.exit('usage: proforma-to-json.py <proforma.xlsx> <out.json>')
source, out_path = sys.argv[1], sys.argv[2]
repo = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
if os.path.realpath(out_path).startswith(repo + os.sep):
    sys.exit('Refusing to write salaries into the repo. Write the JSON to a scratch folder.')

formulas = openpyxl.load_workbook(source, data_only=False)
values = openpyxl.load_workbook(source, data_only=True)
step1, step2, step3, multi = 'Step 1 Proforma', 'Step 2 Proforma', 'Step 3 Proforma', 'Multi Year'
warnings = []


def val(sheet, cell):
    return values[sheet][cell].value


def formula(sheet, cell):
    raw = formulas[sheet][cell].value
    return raw if isinstance(raw, str) and raw.startswith('=') else None


def cents(amount):
    return int(round(float(amount or 0) * 100))


def bps(rate):
    return int(round(float(rate) * 10000))


def factor(sheet, cell, pattern):
    """The number a formula multiplies by, e.g. '=B35*0.015' -> 0.015."""
    text = formula(sheet, cell) or ''
    match = re.search(pattern, text)
    if not match:
        raise SystemExit(f'{sheet}!{cell} changed ({text!r}); update proforma-to-json.py.')
    return float(match.group(1))


def tidy(label):
    label = str(label).strip()
    label = label.replace('1/2 Day rate K-4th', '½ day K–4th').replace('5th-8th', '5th–8th')
    return {'Clt': 'CLT', 'Payroll': 'Payroll service'}.get(label, label)


def placeholder(label):
    return not label or str(label).strip().upper() == 'NAME'


def year_note(text):
    """'=F40*1.25' -> 'Sheet: Year 1 × 1.25' (F is Year 1 in Multi Year, H is Year 2)."""
    if not text:
        return ''
    body = re.sub(r'\bF\d+', 'Year 1', text[1:])
    body = re.sub(r'\bH\d+', 'Year 2', body).replace('*', ' × ').replace('+', ' + ')
    return f'Sheet: {body}'


def sheet_note(sheet, cell):
    """Keep a hand-typed arithmetic formula (=9.5*7000) as the line's note."""
    text = formula(sheet, cell)
    if text and re.fullmatch(r'=[\d.+\-*/() ]+', text):
        return f'Sheet: {text[1:]}'
    return ''


# ---- Year 1 (Step 1–3): low and high census ----

def year1_tiers(students_col):
    tiers = []
    for row in range(5, 12):
        label, tuition = val(step2, f'D{row}'), val(step2, f'E{row}')
        if label and tuition:
            tiers.append({'label': tidy(label), 'tuitionCents': cents(tuition), 'students': int(val(step2, f'{students_col}{row}') or 0)})
    return tiers


def year1_fees():
    fees = []
    for row in range(13, 16):
        label, amount = val(step2, f'D{row}'), val(step2, f'E{row}')
        if label and amount:
            # Registration is charged to every student (F13 = F12, the census).
            fees.append({'label': tidy(label), 'amountCents': cents(amount), 'students': None})
    return fees


def year1_staff():
    staff = []
    for row in range(2, 34):
        name, pay = val(step1, f'A{row}'), val(step1, f'B{row}')
        if not placeholder(name) and pay:
            staff.append({'name': str(name).strip(), 'group': 'faculty', 'role': '', 'payCents': cents(pay), 'onPayroll': True})
    for row in range(2, 34):
        title, pay = val(step1, f'D{row}'), val(step1, f'E{row}')
        if not placeholder(title) and title not in ('TOTAL',) and pay is not None:
            staff.append({'name': str(title).strip(), 'group': 'leadership', 'role': str(title).strip(), 'payCents': cents(pay), 'onPayroll': True})
    return staff


def year1_lines(first_tier):
    lines = []
    # Discounts. Faculty: rate × the first tier's tuition × students taught (Step 1 H33/H34, I34 = H34 × E12 = E5).
    lines.append({'section': 'discounts', 'kind': 'faculty', 'label': 'Faculty discount', 'rule': 'pct_tuition_count',
                  'rateBps': bps(val(step1, 'H34')), 'count': int(val(step1, 'H33')), 'tierLabel': first_tier,
                  'note': 'Faculty children: discount × tuition × students.'})
    # Family: Step 3 B13 is =10400+8000: church savings (Step 2 G23) and $400 × 20 TPC members (G21 × H21).
    if formula(step3, 'B13') != '=10400+8000':
        warnings.append(f"Step 3 B13 is now {formula(step3, 'B13')!r}; family discounts need a look.")
    lines.append({'section': 'discounts', 'kind': 'family', 'label': 'Church savings', 'rule': 'flat', 'amountCents': cents(val(step2, 'G23'))})
    tpc_each, tpc_count = val(step2, 'G21'), val(step2, 'H21')
    lines.append({'section': 'discounts', 'kind': 'family', 'label': 'TPC member discount', 'rule': 'flat', 'amountCents': cents(tpc_each * tpc_count),
                  'note': f'TPC members receive a ${tpc_each:,.0f} discount × {tpc_count:.0f} students.'})
    if val(step3, 'B14'):
        lines.append({'section': 'discounts', 'kind': 'assistance', 'label': 'Tuition assistance', 'rule': 'flat', 'amountCents': cents(val(step3, 'B14'))})
    # Fixed (Step 2 A2:B14), flat per year.
    for row in range(2, 15):
        label, amount = val(step2, f'A{row}'), val(step2, f'B{row}')
        if not placeholder(label) and amount:
            lines.append({'section': 'fixed', 'label': tidy(label), 'rule': 'flat', 'amountCents': cents(amount), 'note': sheet_note(step2, f'B{row}')})
    # Variable: per-unit amount in column B, the rule read from column C's formula.
    for section, rows in (('education', range(19, 25)), ('administrative', range(28, 34)), ('facility', range(37, 43))):
        for row in rows:
            label, amount = val(step2, f'A{row}'), val(step2, f'B{row}')
            if placeholder(label) or not amount:
                continue
            text = formula(step2, f'C{row}') or ''
            rule = 'per_faculty' if 'Step 1 Proforma' in text else 'per_student_monthly' if text.endswith('*12') else 'per_student'
            lines.append({'section': section, 'label': tidy(label), 'rule': rule, 'amountCents': cents(amount)})
        if section == 'administrative':
            rate = factor(step3, 'B67', r'\(B10-B12-B14\)\*([\d.]+)')
            lines.append({'section': 'administrative', 'label': 'Bank processing fees', 'rule': 'pct_collected', 'rateBps': bps(rate),
                          'note': 'Card/ACH fees on what families pay: gross less faculty discount and assistance.'})
    return lines


def year1(name, students_col, primary):
    tiers = year1_tiers(students_col)
    return {
        'name': name, 'schoolYear': '2026–27', 'primary': primary,
        'notes': 'Imported from the AYE 2027 proforma (Steps 1–3).',
        'settings': {
            'subRateBps': bps(factor(step1, 'B37', r'\*([\d.]+)$')),
            'payrollTaxBps': bps(val(step1, 'C41')),
            'medicalCents': cents(val(step1, 'H39')),
            'retirementCents': cents(val(step1, 'H41')),
            'churchDonationCents': cents(val(step3, 'B82')),
        },
        'tiers': tiers, 'fees': year1_fees(), 'staff': year1_staff(), 'lines': year1_lines(tiers[0]['label']),
    }


# ---- Years 2 and 3 (Multi Year H and I) ----

def grown(staff, rate):
    return [{**person, 'payCents': int(round(person['payCents'] * rate))} for person in staff]


def year_n(col, name, school_year, staff):
    census = int(val(multi, f'{col}2'))
    lines = []
    for row, kind, label in ((14, 'faculty', 'Faculty discount'), (15, 'family', 'Family discounts')):
        rate = factor(multi, f'{col}{row}', rf'={col}6\*([\d.]+)')
        lines.append({'section': 'discounts', 'kind': kind, 'label': label, 'rule': 'pct_tuition', 'rateBps': bps(rate)})
    if val(multi, f'{col}16'):
        lines.append({'section': 'discounts', 'kind': 'assistance', 'label': 'Tuition assistance', 'rule': 'flat', 'amountCents': cents(val(multi, f'{col}16'))})

    def variable(section, row):
        label = val(multi, f'A{row}')
        if placeholder(label):
            return None
        text, amount = formula(multi, f'{col}{row}') or '', val(multi, f'{col}{row}')
        per_student = re.fullmatch(rf'={col}2\*([\d.]+)', text)
        if per_student:
            return {'section': section, 'label': tidy(label), 'rule': 'per_student', 'amountCents': cents(per_student.group(1))}
        if amount:
            return {'section': section, 'label': tidy(label), 'rule': 'flat', 'amountCents': cents(amount), 'note': year_note(text)}
        return None

    # Fixed: a blank cell carries Year 1's amount forward (the sheet left rent, internet and others out).
    for row in range(38, 51):
        label = val(multi, f'A{row}')
        if placeholder(label):
            continue
        amount = val(multi, f'{col}{row}')
        if amount is None and val(multi, f'F{row}'):
            lines.append({'section': 'fixed', 'label': tidy(label), 'rule': 'flat', 'amountCents': cents(val(multi, f'F{row}')), 'note': 'Carried from Year 1 (blank in the sheet).'})
        elif amount:
            text = formula(multi, f'{col}{row}')
            lines.append({'section': 'fixed', 'label': tidy(label), 'rule': 'flat', 'amountCents': cents(amount), 'note': year_note(text)})
    for section, rows in (('education', range(55, 61)), ('administrative', range(63, 69)), ('facility', range(72, 78))):
        for row in rows:
            item = variable(section, row)
            if item:
                lines.append(item)
        if section == 'administrative':
            rate = factor(multi, f'{col}69', rf'={col}19\*([\d.]+)')
            lines.append({'section': 'administrative', 'label': 'Bank processing fees', 'rule': 'pct_collected', 'rateBps': bps(rate),
                          'note': 'The sheet takes this rate of net revenue after all discounts.'})
    return {
        'name': name, 'schoolYear': school_year, 'primary': True,
        'notes': f'Imported from the proforma Multi Year tab, column {col}.',
        'settings': {
            'subRateBps': bps(factor(multi, f'{col}28', rf'={col}26\*([\d.]+)')),
            'payrollTaxBps': bps(factor(multi, f'{col}30', r'\*([\d.]+)$')),
            'medicalCents': 0, 'retirementCents': 0,
            'churchDonationCents': cents(val(multi, f'{col}84')),
        },
        'tiers': [{'label': 'All grades (average)', 'tuitionCents': cents(val(multi, f'{col}3')), 'students': census}],
        'fees': [{'label': 'Registration Fee', 'amountCents': cents(val(multi, f'{col}5')), 'students': None}],
        'staff': staff,
        'lines': lines,
    }


low = year1('AYE 2027 — low census', 'F', True)
high = year1('AYE 2027 — high census', 'G', False)

# Staffing growth, from the Multi Year formulas (checked so a changed sheet fails loudly).
expected = {'H24': '=F24+75000', 'H26': '=F26*1.03+30000', 'I24': '=H24*1.03', 'I26': '=H26*1.03+30000+10000'}
for cell, text in expected.items():
    if formula(multi, cell) != text:
        raise SystemExit(f'Multi Year {cell} is {formula(multi, cell)!r}, expected {text!r}; update proforma-to-json.py.')
faculty1 = [p for p in low['staff'] if p['group'] == 'faculty']
leaders1 = [p for p in low['staff'] if p['group'] == 'leadership']
hire = lambda name, pay, group: {'name': name, 'group': group, 'role': 'Placeholder', 'payCents': cents(pay), 'onPayroll': True}
staff2 = grown(faculty1, 1.03) + [hire('New faculty hire(s)', 30000, 'faculty')] + leaders1 + [hire('New leadership hire', 75000, 'leadership')]
staff3 = [*grown([p for p in staff2 if p['group'] == 'faculty'], 1.03), hire('New faculty hire(s), Year 3', 40000, 'faculty'),
          *grown([p for p in staff2 if p['group'] == 'leadership'], 1.03)]

scenarios = [low, high, year_n('H', 'AYE 2028 — Year 2', '2027–28', staff2), year_n('I', 'AYE 2029 — Year 3', '2028–29', staff3)]
with open(out_path, 'w') as handle:
    json.dump({'source': 'Trinity Classical Academy - Birmingham Proforma AYE 2027', 'scenarios': scenarios}, handle, indent=1, ensure_ascii=False)
for warning in warnings:
    print('warning:', warning, file=sys.stderr)
print(f'Wrote {len(scenarios)} scenarios to {out_path}')
