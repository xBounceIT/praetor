export type RevisionCodeTemplate = {
  prefix: string;
  template: string;
  sequencePadding: number;
};

export const DEFAULT_REVISION_CODE_TEMPLATE: RevisionCodeTemplate = {
  prefix: 'REV',
  template: '{PREFIX}{SEQ}',
  sequencePadding: 1,
};

export const renderRevisionCode = (
  config: RevisionCodeTemplate,
  revisionNumber: number,
): string => {
  const sequence = String(revisionNumber).padStart(config.sequencePadding, '0');
  return config.template.replaceAll('{PREFIX}', config.prefix).replaceAll('{SEQ}', sequence);
};

export const validateRevisionCodeTemplate = (
  value: unknown,
): { ok: true; value: RevisionCodeTemplate } | { ok: false; message: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'template configuration must be an object' };
  }
  const candidate = value as Partial<RevisionCodeTemplate>;
  if (typeof candidate.prefix !== 'string' || !/^[A-Za-z0-9_-]{0,20}$/.test(candidate.prefix)) {
    return {
      ok: false,
      message: 'prefix may contain only letters, numbers, underscores and hyphens',
    };
  }
  if (
    typeof candidate.template !== 'string' ||
    candidate.template.length < 5 ||
    candidate.template.length > 100 ||
    !candidate.template.includes('{SEQ}')
  ) {
    return { ok: false, message: 'template must contain {SEQ} and be at most 100 characters' };
  }
  const literal = candidate.template.replaceAll('{PREFIX}', '').replaceAll('{SEQ}', '');
  if (
    !/^[A-Za-z0-9 _-]*$/.test(literal) ||
    /\{[^}]*\}/.test(candidate.template.replaceAll('{PREFIX}', '').replaceAll('{SEQ}', ''))
  ) {
    return { ok: false, message: 'template contains unsupported placeholders or characters' };
  }
  if (
    !Number.isInteger(candidate.sequencePadding) ||
    Number(candidate.sequencePadding) < 1 ||
    Number(candidate.sequencePadding) > 12
  ) {
    return { ok: false, message: 'sequencePadding must be an integer between 1 and 12' };
  }
  const result = {
    prefix: candidate.prefix,
    template: candidate.template,
    sequencePadding: Number(candidate.sequencePadding),
  };
  if (renderRevisionCode(result, 1).length > 50) {
    return { ok: false, message: 'rendered revision code must not exceed 50 characters' };
  }
  return { ok: true, value: result };
};
