import { Check, FileText, Loader2, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import type { DocumentCodeModuleId, DocumentCodeTemplate } from '../../types';

type EditableTemplate = DocumentCodeTemplate;
type TemplateErrorMap = Record<string, string>;
type SettingsT = (key: string, options?: Record<string, unknown>) => string;

interface DocumentCodeSettingsProps {
  animationClass?: string;
}

const KNOWN_PLACEHOLDERS = new Set(['PREFIX', 'YY', 'YYYY', 'SEQ']);
const PREFIX_PATTERN = /^[A-Za-z0-9_-]+$/;
const TEMPLATE_LITERAL_PATTERN = /^[A-Za-z0-9_-]*$/;

const persistedShape = (templates: EditableTemplate[]) =>
  JSON.stringify(
    templates.map(({ moduleId, prefix, template, sequencePadding }) => ({
      moduleId,
      prefix,
      template,
      sequencePadding,
    })),
  );

const renderPreview = (row: EditableTemplate) => {
  const year = String(new Date().getFullYear());
  return row.template
    .replaceAll('{PREFIX}', row.prefix)
    .replaceAll('{YYYY}', year)
    .replaceAll('{YY}', year.slice(-2))
    .replaceAll('{SEQ}', '1'.padStart(row.sequencePadding || 4, '0'));
};

const validateTemplates = (rows: EditableTemplate[], t: SettingsT): TemplateErrorMap => {
  const errors: TemplateErrorMap = {};
  for (const row of rows) {
    const prefix = row.prefix.trim();
    const template = row.template.trim();
    if (!prefix) {
      errors[`${row.moduleId}:prefix`] = t('general.documentCodes.errors.prefixRequired');
    } else if (prefix.length > 20) {
      errors[`${row.moduleId}:prefix`] = t('general.documentCodes.errors.prefixLength');
    } else if (!PREFIX_PATTERN.test(prefix)) {
      errors[`${row.moduleId}:prefix`] = t('general.documentCodes.errors.prefixPattern');
    }

    if (!template) {
      errors[`${row.moduleId}:template`] = t('general.documentCodes.errors.templateRequired');
    } else if (template.length > 120) {
      errors[`${row.moduleId}:template`] = t('general.documentCodes.errors.templateLength');
    } else if (!template.includes('{SEQ}')) {
      errors[`${row.moduleId}:template`] = t('general.documentCodes.errors.sequenceRequired');
    } else {
      for (const match of template.matchAll(/\{([^}]+)\}/g)) {
        if (!KNOWN_PLACEHOLDERS.has(match[1])) {
          errors[`${row.moduleId}:template`] = t(
            'general.documentCodes.errors.unknownPlaceholder',
            {
              placeholder: `{${match[1]}}`,
            },
          );
          break;
        }
      }
      const literalTemplateText = template.replace(/\{(?:PREFIX|YY|YYYY|SEQ)\}/g, '');
      if (!errors[`${row.moduleId}:template`] && literalTemplateText.match(/[{}]/)) {
        errors[`${row.moduleId}:template`] = t('general.documentCodes.errors.invalidPlaceholder');
      }
      if (
        !errors[`${row.moduleId}:template`] &&
        !TEMPLATE_LITERAL_PATTERN.test(literalTemplateText)
      ) {
        errors[`${row.moduleId}:template`] = t('general.documentCodes.errors.templateTextPattern');
      }
    }

    if (
      !Number.isInteger(row.sequencePadding) ||
      row.sequencePadding < 1 ||
      row.sequencePadding > 9
    ) {
      errors[`${row.moduleId}:sequencePadding`] = t('general.documentCodes.errors.paddingRange');
    }
  }
  return errors;
};

const normalizeRowsForSave = (rows: EditableTemplate[]) =>
  rows.map(({ moduleId, prefix, template, sequencePadding }) => ({
    moduleId,
    prefix: prefix.trim(),
    template: template.trim(),
    sequencePadding,
  }));

const parseTemplateFieldValue = (
  field: 'prefix' | 'template' | 'sequencePadding',
  value: string,
) => (field === 'sequencePadding' ? Number.parseInt(value, 10) : value);

const updateEditableTemplate = (
  row: EditableTemplate,
  field: 'prefix' | 'template' | 'sequencePadding',
  value: string | number,
): EditableTemplate => {
  const nextRow = { ...row, [field]: value } as EditableTemplate;
  return { ...nextRow, preview: renderPreview(nextRow) };
};

const DocumentCodeSettings: React.FC<DocumentCodeSettingsProps> = ({ animationClass }) => {
  const { t } = useTranslation('settings');
  const [templates, setTemplates] = useState<EditableTemplate[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<EditableTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const translate = useCallback<SettingsT>((key, options) => t(key, options), [t]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    api.documentCodeTemplates
      .list()
      .then((rows) => {
        if (cancelled) return;
        setTemplates(rows);
        setSavedTemplates(rows);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const errors = useMemo(() => validateTemplates(templates, translate), [templates, translate]);
  const hasErrors = Object.keys(errors).length > 0;
  const templatesShape = useMemo(() => persistedShape(templates), [templates]);
  const savedTemplatesShape = useMemo(() => persistedShape(savedTemplates), [savedTemplates]);
  const hasChanges = templatesShape !== savedTemplatesShape;

  const updateTemplate = (
    moduleId: DocumentCodeModuleId,
    field: 'prefix' | 'template' | 'sequencePadding',
    value: string,
  ) => {
    setIsSaved(false);
    setSaveError(null);
    const nextValue = parseTemplateFieldValue(field, value);
    setTemplates((prev) =>
      prev.map((row) =>
        row.moduleId === moduleId ? updateEditableTemplate(row, field, nextValue) : row,
      ),
    );
  };

  const handleReset = () => {
    setTemplates(savedTemplates);
    setSaveError(null);
    setIsSaved(false);
  };

  const handleSave = async () => {
    if (hasErrors || isSaving || !hasChanges) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await api.documentCodeTemplates.update(normalizeRowsForSave(templates));
      setTemplates(updated);
      setSavedTemplates(updated);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const moduleLabel = (row: EditableTemplate) =>
    t(`general.documentCodes.modules.${row.moduleId}`, { defaultValue: row.label });

  if (isLoading) {
    return (
      <Card
        className={cn(
          'gap-0 overflow-hidden rounded-lg border-border bg-background py-0',
          animationClass,
        )}
      >
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {t('general.documentCodes.loading')}
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Alert variant="destructive" className={animationClass}>
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>{t('general.documentCodes.loadFailed')}</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card
      className={cn(
        'gap-0 overflow-hidden rounded-lg border-border bg-background py-0',
        animationClass,
      )}
    >
      <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <FileText aria-hidden="true" className="size-4 text-praetor" />
          {t('general.documentCodes.title')}
        </CardTitle>
        <CardDescription>{t('general.documentCodes.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        <Alert>
          <FileText aria-hidden="true" />
          <AlertTitle>{t('general.documentCodes.placeholdersTitle')}</AlertTitle>
          <AlertDescription>{t('general.documentCodes.placeholdersDescription')}</AlertDescription>
        </Alert>

        {saveError && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{t('general.documentCodes.saveFailed')}</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[12rem]">{t('general.documentCodes.module')}</TableHead>
                <TableHead className="min-w-[9rem]">{t('general.documentCodes.prefix')}</TableHead>
                <TableHead className="min-w-[14rem]">
                  {t('general.documentCodes.template')}
                </TableHead>
                <TableHead className="min-w-[7rem]">
                  {t('general.documentCodes.sequenceDigits')}
                </TableHead>
                <TableHead className="min-w-[10rem]">
                  {t('general.documentCodes.preview')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((row) => {
                const prefixError = errors[`${row.moduleId}:prefix`];
                const templateError = errors[`${row.moduleId}:template`];
                const paddingError = errors[`${row.moduleId}:sequencePadding`];
                return (
                  <TableRow key={row.moduleId}>
                    <TableCell className="whitespace-normal font-medium">
                      {moduleLabel(row)}
                    </TableCell>
                    <TableCell className="align-top">
                      <Field data-invalid={Boolean(prefixError)}>
                        <FieldLabel className="sr-only" htmlFor={`${row.moduleId}-prefix`}>
                          {t('general.documentCodes.prefix')}
                        </FieldLabel>
                        <Input
                          id={`${row.moduleId}-prefix`}
                          value={row.prefix}
                          onChange={(event) =>
                            updateTemplate(row.moduleId, 'prefix', event.target.value)
                          }
                          aria-invalid={Boolean(prefixError)}
                          className="h-8 font-mono text-xs"
                        />
                        <FieldError className="text-xs">{prefixError}</FieldError>
                      </Field>
                    </TableCell>
                    <TableCell className="align-top">
                      <Field data-invalid={Boolean(templateError)}>
                        <FieldLabel className="sr-only" htmlFor={`${row.moduleId}-template`}>
                          {t('general.documentCodes.template')}
                        </FieldLabel>
                        <Input
                          id={`${row.moduleId}-template`}
                          value={row.template}
                          onChange={(event) =>
                            updateTemplate(row.moduleId, 'template', event.target.value)
                          }
                          aria-invalid={Boolean(templateError)}
                          className="h-8 font-mono text-xs"
                        />
                        <FieldError className="text-xs">{templateError}</FieldError>
                      </Field>
                    </TableCell>
                    <TableCell className="align-top">
                      <Field data-invalid={Boolean(paddingError)}>
                        <FieldLabel className="sr-only" htmlFor={`${row.moduleId}-padding`}>
                          {t('general.documentCodes.sequenceDigits')}
                        </FieldLabel>
                        <Input
                          id={`${row.moduleId}-padding`}
                          type="number"
                          min={1}
                          max={9}
                          value={Number.isFinite(row.sequencePadding) ? row.sequencePadding : ''}
                          onChange={(event) =>
                            updateTemplate(row.moduleId, 'sequencePadding', event.target.value)
                          }
                          aria-invalid={Boolean(paddingError)}
                          className="h-8 w-20 font-mono text-xs"
                        />
                        <FieldError className="text-xs">{paddingError}</FieldError>
                      </Field>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {hasErrors ? renderPreview(row) : row.preview || renderPreview(row)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <FieldDescription>{t('general.documentCodes.manualOverride')}</FieldDescription>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={!hasChanges || isSaving}
          >
            <RotateCcw aria-hidden="true" />
            {t('general.documentCodes.reset')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || hasErrors || isSaving}
          >
            {isSaving ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : isSaved ? (
              <Check aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            {isSaving
              ? t('general.saving')
              : isSaved
                ? t('general.changesSaved')
                : t('general.saveConfiguration')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default DocumentCodeSettings;
