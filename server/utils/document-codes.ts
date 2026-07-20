export const DOCUMENT_CODE_MODULE_IDS = [
  'client_quote',
  'client_offer',
  'supplier_quote',
  'client_order',
  'supplier_order',
  'client_invoice',
  'supplier_invoice',
] as const;

export type DocumentCodeModuleId = (typeof DOCUMENT_CODE_MODULE_IDS)[number];

export type DocumentCodeTemplateConfig = {
  moduleId: DocumentCodeModuleId;
  label: string;
  prefix: string;
  template: string;
  sequencePadding: number;
};

export const DOCUMENT_CODE_MODULES: Record<DocumentCodeModuleId, DocumentCodeTemplateConfig> = {
  client_quote: {
    moduleId: 'client_quote',
    label: 'Client quotes',
    prefix: 'PREV',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
  },
  client_offer: {
    moduleId: 'client_offer',
    label: 'Client offers',
    prefix: 'OFF',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
  },
  supplier_quote: {
    moduleId: 'supplier_quote',
    label: 'Supplier quotes',
    prefix: 'FORN',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
  },
  client_order: {
    moduleId: 'client_order',
    label: 'Client orders',
    prefix: 'ORD',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
  },
  supplier_order: {
    moduleId: 'supplier_order',
    label: 'Supplier orders',
    prefix: 'SORD',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
  },
  client_invoice: {
    moduleId: 'client_invoice',
    label: 'Client invoices',
    prefix: 'INV',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
  },
  supplier_invoice: {
    moduleId: 'supplier_invoice',
    label: 'Supplier invoices',
    prefix: 'SINV',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
  },
};

export const DOCUMENT_CODE_MAX_LENGTH = 100;
const DOCUMENT_CODE_SAFE_CHARACTERS_PATTERN = /^[A-Za-z0-9_-]+$/;

export type DocumentCodeValueValidationResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

/** Validate a new manual document code without tightening persisted legacy identifiers. */
export const validateDocumentCodeValue = (
  value: string,
  fieldName = 'document code',
): DocumentCodeValueValidationResult => {
  if (value.length > DOCUMENT_CODE_MAX_LENGTH) {
    return {
      ok: false,
      message: `${fieldName} must be ${DOCUMENT_CODE_MAX_LENGTH} characters or fewer`,
    };
  }
  if (!DOCUMENT_CODE_SAFE_CHARACTERS_PATTERN.test(value)) {
    return {
      ok: false,
      message: `${fieldName} can only contain letters, numbers, underscores, and hyphens`,
    };
  }
  return { ok: true, value };
};
export const DOCUMENT_CODE_TEMPLATE_MAX_LENGTH = 120;
export const DOCUMENT_CODE_PREFIX_MAX_LENGTH = 20;
export const DOCUMENT_CODE_SEQUENCE_PADDING_MIN = 1;
export const DOCUMENT_CODE_SEQUENCE_PADDING_MAX = 9;
export const DOCUMENT_CODE_YEAR_MIN = 1;
export const DOCUMENT_CODE_YEAR_MAX = 9999;

const DOCUMENT_CODE_PLACEHOLDERS = new Set(['PREFIX', 'YY', 'YYYY', 'SEQ']);
const TEMPLATE_LITERAL_PATTERN = /^[A-Za-z0-9_-]*$/;
const YEAR_PLACEHOLDER_PATTERN = /\{(?:YY|YYYY)\}/;
const DOCUMENT_CODE_COUNTER_SEPARATOR_PATTERN = /[-_]/;
const DOCUMENT_CODE_TEMPLATE_PLACEHOLDER_PATTERN = /\{(PREFIX|YY|YYYY|SEQ)\}/g;
const MAX_SEQUENCE_FOR_LENGTH_CHECK = 999_999_999;
const DOCUMENT_CODE_MAX_RESERVED_SEQUENCE = 2_147_483_646;

export type ParsedDocumentCodeCounter = {
  year: number;
  sequence: number;
};

export const isDocumentCodeModuleId = (value: unknown): value is DocumentCodeModuleId =>
  typeof value === 'string' && (DOCUMENT_CODE_MODULE_IDS as readonly string[]).includes(value);

export const getDocumentCodeYear = (date: Date | string = new Date()): number => {
  const year =
    typeof date === 'string'
      ? /^\d{4}/.test(date)
        ? Number.parseInt(date.slice(0, 4), 10)
        : Number.NaN
      : date.getFullYear();
  if (!Number.isInteger(year) || year < DOCUMENT_CODE_YEAR_MIN || year > DOCUMENT_CODE_YEAR_MAX) {
    throw new Error('Document code date must start with a valid 4-digit year');
  }
  return year;
};

export const formatDocumentSequence = (sequence: string | number | bigint, padding: number) => {
  const value = String(sequence);
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid sequence value: ${value}`);
  }
  return value.padStart(padding, '0');
};

const parseDocumentCodeYearPart = (yearPart: string): number | null => {
  const year = /^\d{2}$/.test(yearPart)
    ? 2000 + Number.parseInt(yearPart, 10)
    : /^\d{4}$/.test(yearPart)
      ? Number.parseInt(yearPart, 10)
      : Number.NaN;
  if (!Number.isInteger(year) || year < DOCUMENT_CODE_YEAR_MIN || year > DOCUMENT_CODE_YEAR_MAX) {
    return null;
  }
  return year;
};

const parseDocumentCodeSequencePart = (sequencePart: string): number | null => {
  if (!/^\d+$/.test(sequencePart)) return null;
  const sequence = Number.parseInt(sequencePart, 10);
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > DOCUMENT_CODE_MAX_RESERVED_SEQUENCE
  ) {
    return null;
  }
  return sequence;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type DocumentCodeTemplatePlaceholder = 'PREFIX' | 'YY' | 'YYYY' | 'SEQ';
type DocumentCodeTemplateCapture = Exclude<DocumentCodeTemplatePlaceholder, 'PREFIX'>;

const buildDocumentCodeTemplateRegex = (
  config: Pick<DocumentCodeTemplateConfig, 'prefix' | 'template'>,
): { regex: RegExp; captures: DocumentCodeTemplateCapture[] } => {
  let pattern = '^';
  let cursor = 0;
  const captures: DocumentCodeTemplateCapture[] = [];

  for (const match of config.template.matchAll(DOCUMENT_CODE_TEMPLATE_PLACEHOLDER_PATTERN)) {
    const index = match.index ?? 0;
    pattern += escapeRegExp(config.template.slice(cursor, index));
    const placeholder = match[1] as DocumentCodeTemplatePlaceholder;
    if (placeholder === 'PREFIX') {
      pattern += escapeRegExp(config.prefix);
    } else {
      captures.push(placeholder);
      pattern += placeholder === 'SEQ' ? '(\\d+)' : placeholder === 'YY' ? '(\\d{2})' : '(\\d{4})';
    }
    cursor = index + match[0].length;
  }

  pattern += escapeRegExp(config.template.slice(cursor));
  return { regex: new RegExp(`${pattern}$`), captures };
};

export const parseDocumentCodeCounterFromTemplate = (
  code: unknown,
  config: Pick<DocumentCodeTemplateConfig, 'prefix' | 'template'>,
): ParsedDocumentCodeCounter | null => {
  if (typeof code !== 'string') return null;
  const { regex, captures } = buildDocumentCodeTemplateRegex(config);
  const match = regex.exec(code.trim());
  if (!match) return null;

  let year: number | null = null;
  let sequence: number | null = null;
  let captureIndex = 1;

  for (const capture of captures) {
    const value = match[captureIndex];
    captureIndex += 1;
    if (!value) return null;

    if (capture === 'SEQ') {
      const parsedSequence = parseDocumentCodeSequencePart(value);
      if (parsedSequence === null || (sequence !== null && sequence !== parsedSequence)) {
        return null;
      }
      sequence = parsedSequence;
      continue;
    }

    const parsedYear = parseDocumentCodeYearPart(value);
    if (parsedYear === null || (year !== null && year !== parsedYear)) {
      return null;
    }
    year = parsedYear;
  }

  return year !== null && sequence !== null ? { year, sequence } : null;
};

export const parseDocumentCodeCounterFromTemplates = (
  code: unknown,
  templates: readonly Pick<DocumentCodeTemplateConfig, 'prefix' | 'template'>[],
): ParsedDocumentCodeCounter | null => {
  for (const template of templates) {
    const parsed = parseDocumentCodeCounterFromTemplate(code, template);
    if (parsed) return parsed;
  }
  return null;
};

export const parseDocumentCodeCounter = (code: unknown): ParsedDocumentCodeCounter | null => {
  if (typeof code !== 'string') return null;
  const parts = code.trim().split(DOCUMENT_CODE_COUNTER_SEPARATOR_PATTERN);
  if (parts.length < 3 || parts[0].length === 0) return null;

  let firstCandidate: ParsedDocumentCodeCounter | null = null;
  let firstCandidateYearPart: string | null = null;
  let firstCandidateSequencePart: string | null = null;
  let lastFullYearCandidate: ParsedDocumentCodeCounter | null = null;
  for (let yearIndex = 1; yearIndex <= parts.length - 2; yearIndex += 1) {
    const yearPart = parts[yearIndex];
    const year = parseDocumentCodeYearPart(yearPart);
    if (year === null) continue;

    const sequencePart = parts[yearIndex + 1];
    const sequence = parseDocumentCodeSequencePart(sequencePart);
    if (sequence === null) continue;

    const candidate = { year, sequence };
    if (!firstCandidate) {
      firstCandidate = candidate;
      firstCandidateYearPart = yearPart;
      firstCandidateSequencePart = sequencePart;
    }
    if (yearPart.length === 4 && !yearPart.startsWith('0')) {
      lastFullYearCandidate = candidate;
    }
  }

  if (firstCandidate && firstCandidateYearPart?.length === 4) {
    return firstCandidate;
  }

  const firstCandidateHasPaddedSequence =
    firstCandidate !== null &&
    firstCandidateSequencePart !== null &&
    firstCandidateSequencePart.length > String(firstCandidate.sequence).length;

  if (
    firstCandidate &&
    firstCandidateYearPart?.length === 2 &&
    (firstCandidateHasPaddedSequence || lastFullYearCandidate?.year === firstCandidate.year)
  ) {
    return firstCandidate;
  }

  return lastFullYearCandidate ?? firstCandidate;
};

export const renderDocumentCode = (
  config: Pick<DocumentCodeTemplateConfig, 'prefix' | 'template' | 'sequencePadding'>,
  options: { year: number; sequence: number | bigint },
): string => {
  const fullYear = String(options.year).padStart(4, '0');
  const shortYear = fullYear.slice(-2);
  return config.template
    .replaceAll('{PREFIX}', config.prefix)
    .replaceAll('{YYYY}', fullYear)
    .replaceAll('{YY}', shortYear)
    .replaceAll('{SEQ}', formatDocumentSequence(options.sequence, config.sequencePadding));
};

export type DocumentCodeValidationResult =
  | { ok: true; value: Omit<DocumentCodeTemplateConfig, 'label'> }
  | { ok: false; message: string };

export const validateDocumentCodeTemplate = (input: {
  moduleId: unknown;
  prefix: unknown;
  template: unknown;
  sequencePadding: unknown;
}): DocumentCodeValidationResult => {
  if (!isDocumentCodeModuleId(input.moduleId)) {
    return { ok: false, message: 'moduleId is invalid' };
  }
  if (typeof input.prefix !== 'string') {
    return { ok: false, message: 'prefix must be a string' };
  }
  const prefix = input.prefix.trim();
  if (!prefix) return { ok: false, message: 'prefix cannot be blank' };
  if (prefix.length > DOCUMENT_CODE_PREFIX_MAX_LENGTH) {
    return {
      ok: false,
      message: `prefix must be ${DOCUMENT_CODE_PREFIX_MAX_LENGTH} characters or fewer`,
    };
  }
  if (!DOCUMENT_CODE_SAFE_CHARACTERS_PATTERN.test(prefix)) {
    return {
      ok: false,
      message: 'prefix can only contain letters, numbers, underscores, and hyphens',
    };
  }
  if (typeof input.template !== 'string') {
    return { ok: false, message: 'template must be a string' };
  }
  const template = input.template.trim();
  if (!template) return { ok: false, message: 'template cannot be blank' };
  if (template.length > DOCUMENT_CODE_TEMPLATE_MAX_LENGTH) {
    return {
      ok: false,
      message: `template must be ${DOCUMENT_CODE_TEMPLATE_MAX_LENGTH} characters or fewer`,
    };
  }
  if (!template.includes('{SEQ}')) {
    return { ok: false, message: 'template must include {SEQ}' };
  }
  for (const match of template.matchAll(/\{([^}]+)\}/g)) {
    if (!DOCUMENT_CODE_PLACEHOLDERS.has(match[1])) {
      return { ok: false, message: `Unknown placeholder {${match[1]}}` };
    }
  }
  const literalTemplateText = template.replace(/\{(?:PREFIX|YY|YYYY|SEQ)\}/g, '');
  if (literalTemplateText.match(/[{}]/)) {
    return { ok: false, message: 'template contains an invalid placeholder' };
  }
  if (!YEAR_PLACEHOLDER_PATTERN.test(template)) {
    return { ok: false, message: 'template must include {YY} or {YYYY}' };
  }
  if (!TEMPLATE_LITERAL_PATTERN.test(literalTemplateText)) {
    return {
      ok: false,
      message:
        'template text can only contain letters, numbers, underscores, hyphens, and placeholders',
    };
  }

  const padding =
    typeof input.sequencePadding === 'number'
      ? input.sequencePadding
      : typeof input.sequencePadding === 'string' && /^\d+$/.test(input.sequencePadding.trim())
        ? Number(input.sequencePadding)
        : Number.NaN;
  if (
    !Number.isInteger(padding) ||
    padding < DOCUMENT_CODE_SEQUENCE_PADDING_MIN ||
    padding > DOCUMENT_CODE_SEQUENCE_PADDING_MAX
  ) {
    return {
      ok: false,
      message: `sequencePadding must be an integer between ${DOCUMENT_CODE_SEQUENCE_PADDING_MIN} and ${DOCUMENT_CODE_SEQUENCE_PADDING_MAX}`,
    };
  }

  const rendered = renderDocumentCode(
    { prefix, template, sequencePadding: padding },
    {
      year: new Date().getFullYear(),
      sequence: MAX_SEQUENCE_FOR_LENGTH_CHECK,
    },
  );
  if (rendered.length > DOCUMENT_CODE_MAX_LENGTH) {
    return {
      ok: false,
      message: `rendered document code must be ${DOCUMENT_CODE_MAX_LENGTH} characters or fewer`,
    };
  }

  return {
    ok: true,
    value: {
      moduleId: input.moduleId,
      prefix,
      template,
      sequencePadding: padding,
    },
  };
};

export const withDocumentCodeDefaults = (
  template: Partial<Omit<DocumentCodeTemplateConfig, 'label'>> & { moduleId: DocumentCodeModuleId },
): DocumentCodeTemplateConfig => ({
  ...DOCUMENT_CODE_MODULES[template.moduleId],
  ...template,
  label: DOCUMENT_CODE_MODULES[template.moduleId].label,
});
