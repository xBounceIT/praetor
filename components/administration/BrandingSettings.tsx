import { ImageOff, Loader2, Save, Trash2, Upload } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import type { AppBranding } from '../../types';
import { toastError, toastSuccess } from '../../utils/toast';

const COMPANY_NAME_MAX_LENGTH = 120;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export interface BrandingSettingsProps {
  branding: AppBranding;
  onChange: (branding: AppBranding) => void;
  animationClass?: string;
}

const BrandingSettings: React.FC<BrandingSettingsProps> = ({
  branding,
  onChange,
  animationClass,
}) => {
  const { t } = useTranslation('settings');
  const [companyName, setCompanyName] = useState(branding.companyName ?? '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep the local field in sync when branding is (re)loaded or changed elsewhere.
  useEffect(() => {
    setCompanyName(branding.companyName ?? '');
  }, [branding.companyName]);

  const nameChanged = companyName.trim() !== (branding.companyName ?? '');
  const busy = isSavingName || isUploading || isRemoving;

  const handleSaveName = async () => {
    setIsSavingName(true);
    try {
      const trimmed = companyName.trim();
      const updated = await api.branding.updateName(trimmed.length > 0 ? trimmed : null);
      onChange(updated);
      toastSuccess(t('branding.nameSaved'));
    } catch (err) {
      console.error('Failed to save company name:', err);
      toastError(t('branding.saveFailed'));
    } finally {
      setIsSavingName(false);
    }
  };

  const validateFile = (file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ACCEPTED_EXTENSIONS.includes(ext)) return t('branding.invalidType');
    const typeOk =
      file.type === '' ||
      file.type === 'application/octet-stream' ||
      ACCEPTED_MIME.includes(file.type);
    if (!typeOk) return t('branding.invalidType');
    if (file.size === 0) return t('branding.invalidType');
    if (file.size > MAX_LOGO_BYTES) return t('branding.tooLarge');
    return null;
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so selecting the same file again still fires onChange.
    event.target.value = '';
    if (!file) return;
    const validationError = validateFile(file);
    if (validationError) {
      toastError(validationError);
      return;
    }
    setIsUploading(true);
    try {
      const updated = await api.branding.uploadLogo(file);
      onChange(updated);
      toastSuccess(t('branding.logoUploaded'));
    } catch (err) {
      console.error('Failed to upload logo:', err);
      toastError(t('branding.saveFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    setIsRemoving(true);
    try {
      const updated = await api.branding.deleteLogo();
      onChange(updated);
      toastSuccess(t('branding.logoRemoved'));
    } catch (err) {
      console.error('Failed to remove logo:', err);
      toastError(t('branding.saveFailed'));
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Card
      className={cn(
        'gap-0 overflow-hidden rounded-lg border-border bg-background py-0',
        animationClass,
      )}
    >
      <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <Upload aria-hidden="true" className="size-4 text-praetor" />
          {t('branding.title')}
        </CardTitle>
        <CardDescription>{t('branding.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8 p-6">
        <Field className="max-w-md">
          <FieldLabel htmlFor="branding-company-name">{t('branding.companyNameLabel')}</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="branding-company-name"
              value={companyName}
              maxLength={COMPANY_NAME_MAX_LENGTH}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder={t('branding.companyNamePlaceholder')}
            />
            <Button type="button" onClick={handleSaveName} disabled={busy || !nameChanged}>
              {isSavingName ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Save aria-hidden="true" />
              )}
              {t('branding.save')}
            </Button>
          </div>
          <FieldDescription>{t('branding.companyNameDescription')}</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>{t('branding.logoLabel')}</FieldLabel>
          <div className="flex items-center gap-4">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={t('branding.currentLogoAlt')}
                  className="size-full object-contain p-1"
                />
              ) : (
                <ImageOff aria-hidden="true" className="size-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  {isUploading ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Upload aria-hidden="true" />
                  )}
                  {t('branding.uploadButton')}
                </Button>
                {branding.logoUrl && (
                  <Button type="button" variant="ghost" onClick={handleRemoveLogo} disabled={busy}>
                    {isRemoving ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Trash2 aria-hidden="true" />
                    )}
                    {t('branding.removeButton')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('branding.uploadHint')}</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={handleFileSelected}
          />
          <FieldDescription>{t('branding.logoDescription')}</FieldDescription>
        </Field>
      </CardContent>
    </Card>
  );
};

export default BrandingSettings;
