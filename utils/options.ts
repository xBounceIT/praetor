export const getPaymentTermsOptions = (
  t: (key: string, options?: Record<string, unknown>) => string,
) => [
  { id: 'immediate', name: t('crm:paymentTerms.immediate') },
  { id: '15gg', name: t('crm:paymentTerms.15gg') },
  { id: '21gg', name: t('crm:paymentTerms.21gg') },
  { id: '30gg', name: t('crm:paymentTerms.30gg') },
  { id: '45gg', name: t('crm:paymentTerms.45gg') },
  { id: '60gg', name: t('crm:paymentTerms.60gg') },
  { id: '90gg', name: t('crm:paymentTerms.90gg') },
  { id: '120gg', name: t('crm:paymentTerms.120gg') },
  { id: '180gg', name: t('crm:paymentTerms.180gg') },
  { id: '240gg', name: t('crm:paymentTerms.240gg') },
  { id: '365gg', name: t('crm:paymentTerms.365gg') },
];
