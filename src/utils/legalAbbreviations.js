const LEGAL_ABBREVIATIONS = {
  'Motion': 'Mot.',
  'Objection': 'Obj.',
  'Request': 'Req.',
  'Application': 'App.',
  'Petition': 'Pet.',
  'Memorandum': 'Memo',
  'Opposition': 'Opp.',
  'Response': 'Resp.',
  'Declaration': 'Decl.',
  'Affidavit': 'Aff.',
  'Certificate': 'Cert.',
  'Amended': 'Am.',
  'Supplemental': 'Supp.',
  'Withdrawal': 'W/D',
  'Dismissal': 'Dismiss.',
  'Discharge': 'Disch.',
  'Allowance': 'Allow.',
  'Attorneys Fees': 'Atty Fees',
  'Attorney': 'Atty',
  'Debtor': 'Dbt.',
  'Creditor': 'Cred.',
  'Trustee': 'Trstee',
  'Property of the Estate': 'Prop.',
  'Tax Refunds': 'Tax Ref.',
  'Plan Payments': 'Plan Pmts',
  'Failure to Submit': 'FTS'
};

function abbreviateHearingMatter(hearingMatter, maxLength = 80) {
  if (!hearingMatter) {
    return '';
  }

  if (hearingMatter.length <= maxLength) {
    return hearingMatter;
  }

  let abbreviated = hearingMatter;

  Object.entries(LEGAL_ABBREVIATIONS).forEach(([full, abbr]) => {
    const regex = new RegExp(`\\b${full}\\b`, 'gi');
    abbreviated = abbreviated.replace(regex, abbr);
  });

  if (abbreviated.length <= maxLength) {
    return abbreviated;
  }

  const parts = abbreviated.split(',');
  if (parts.length > 1) {
    const firstPart = parts[0].trim();
    if (firstPart.length <= maxLength - 4) {
      return firstPart + '...';
    }
  }

  const parenMatch = abbreviated.match(/^([^(]+)\(/);
  if (parenMatch && parenMatch[1].trim().length <= maxLength - 4) {
    return parenMatch[1].trim() + '...';
  }

  return abbreviated.substring(0, maxLength - 3) + '...';
}

function abbreviateDebtorNames(caseTitle, maxLength = 40) {
  if (!caseTitle) {
    return '';
  }

  if (caseTitle.length <= maxLength) {
    return caseTitle;
  }

  const names = caseTitle.split(' and ');
  if (names.length === 2) {
    const firstNames = names.map(name => {
      const parts = name.trim().split(' ');
      return parts[0];
    });
    const abbreviated = firstNames.join(' & ');
    if (abbreviated.length <= maxLength) {
      return abbreviated;
    }
  }

  const parts = caseTitle.split(' ');
  if (parts.length >= 2) {
    const lastNameIndex = parts.length - 1;
    const abbreviated = `${parts[0]} ${parts[lastNameIndex]}`;
    if (abbreviated.length <= maxLength) {
      return abbreviated;
    }
  }

  return caseTitle.substring(0, maxLength - 3) + '...';
}

function formatHearingDisplay(hearing) {
  const time = new Date(hearing.scheduled_time).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const room = hearing.court_room || '?';
  const caseNum = hearing.case_number || 'Unknown';

  let debtorNames = '';
  if (hearing.case_title) {
    debtorNames = abbreviateDebtorNames(hearing.case_title);
  } else if (hearing.parties) {
    if (hearing.parties.plaintiff && hearing.parties.defendant) {
      debtorNames = `${hearing.parties.plaintiff} v. ${hearing.parties.defendant}`;
      if (debtorNames.length > 40) {
        const plaintiff = hearing.parties.plaintiff.split(' ')[0];
        const defendant = hearing.parties.defendant.split(' ')[0];
        debtorNames = `${plaintiff} v. ${defendant}`;
      }
    }
  }

  let matter = '';
  if (hearing.hearing_matter) {
    matter = abbreviateHearingMatter(hearing.hearing_matter);
  } else if (hearing.hearing_type) {
    matter = hearing.hearing_type.charAt(0).toUpperCase() + hearing.hearing_type.slice(1);
  }

  const parts = [
    `${time} - Rm ${room}`,
    caseNum,
    debtorNames,
    matter
  ].filter(part => part);

  return parts.join(' - ');
}

module.exports = {
  abbreviateHearingMatter,
  abbreviateDebtorNames,
  formatHearingDisplay,
  LEGAL_ABBREVIATIONS
};
